import { BrowserSetupError } from "./types.js";
import { chromium } from "playwright";
import type {
  Browser,
  BrowserContext,
  Page,
  Route,
  CDPSession,
  Frame,
  FrameLocator,
  Locator
} from "playwright";
import {
  isAllowedUrl,
  isAllowedDocument,
  isVerificationFrame,
  NavigationBlockedError
} from "./url-policy.js";
import { snapshot } from "./snapshot.js";
import type {
  BrowserAutomationDriver,
  BrowserSession,
  BrowserSessionOptions,
  ChromiumBrowserOptions,
  NavigationState,
  PageState
} from "./types.js";

export class PlaywrightChromiumBrowser implements BrowserAutomationDriver {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private readonly allowed: ReadonlySet<string>;
  public constructor(private readonly options: ChromiumBrowserOptions = {}) {
    this.allowed = new Set(
      options.allowedDomains?.map((domain) => domain.toLowerCase()) ?? ["localhost", "127.0.0.1"]
    );
  }
  public async launch(): Promise<void> {
    if (this.browser || this.context) return;
    if (this.options.mode === "attached_chrome") {
      if (!this.options.cdpEndpoint || !isLoopbackCdpEndpoint(this.options.cdpEndpoint))
        throw new Error("attached_chrome requires a loopback-only CDP endpoint.");
      this.browser = await chromium.connectOverCDP(this.options.cdpEndpoint);
      this.context = this.browser.contexts()[0];
      if (!this.context) throw new Error("No existing Chrome context.");
    } else if (this.options.userDataDirectory) {
      try {
        this.context = await chromium.launchPersistentContext(this.options.userDataDirectory, {
          headless: this.options.headless ?? true,
          serviceWorkers: "block",
          acceptDownloads: false,
          ...(this.options.channel ? { channel: this.options.channel } : {})
        });
      } catch (error) {
        if (this.options.channel === "chrome")
          throw new BrowserSetupError(
            "Could not open Google Chrome. Install Chrome if needed, close the manual login windows, then start again."
          );
        throw error;
      }
    } else {
      this.browser = await chromium.launch({
        headless: this.options.headless ?? true,
        ...(this.options.channel ? { channel: this.options.channel } : {})
      });
    }
  }
  public async createSession(options: BrowserSessionOptions = {}): Promise<BrowserSession> {
    await this.launch();
    if (this.options.mode === "attached_chrome" && options.reuseContext === false)
      throw new Error("attached_chrome sessions must reuse Chrome's existing default context.");
    let context = this.context;
    if (!context || options.reuseContext === false) {
      if (!this.browser) throw new Error("Persistent browser only supports its existing context.");
      context = await this.browser.newContext({ serviceWorkers: "block", acceptDownloads: false });
      if (options.reuseContext !== false) this.context = context;
    }
    const attached = this.options.mode === "attached_chrome";
    const page = attached
      ? options.existingPageUrl
        ? context
            .pages()
            .find((candidate) => pageMatchesUrl(candidate.url(), options.existingPageUrl!))
        : context.pages()[0]
      : await context.newPage();
    if (!page) throw new Error("No matching existing Chrome tab.");
    const session = new PlaywrightBrowserSession(
      page,
      this.allowed,
      this.options.maxPageTextLength ?? 12000,
      options.reuseContext === false,
      !attached,
      this.options.navigationMode === "compatible",
      this.options.navigationMode !== "strict"
    );
    await session.installPolicy();
    return session;
  }
  public async close(): Promise<void> {
    if (this.options.mode !== "attached_chrome") await this.context?.close();
    this.context = undefined;
    await this.browser?.close();
    this.browser = undefined;
  }
}
class PlaywrightBrowserSession implements BrowserSession {
  private blocked = false;
  private pending: { url: string; canContinue: boolean } | null = null;
  private readonly approved = new Set<string>();
  private cdp: CDPSession | undefined;
  private mainFrameId = "";
  private transition: Promise<void> | undefined;
  private readonly expectedPopups = new Set<string>();
  public constructor(
    private readonly page: Page,
    private readonly allowed: ReadonlySet<string>,
    private readonly maxText: number,
    private readonly ownsContext: boolean,
    private readonly ownsPage: boolean,
    private readonly compatible: boolean,
    private readonly allowPopups: boolean
  ) {}
  private readonly route = async (route: Route) => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      let frame: Frame;
      try {
        frame = request.frame();
      } catch {
        // Chromium can report a new window's first request before its Frame exists.
        // Correlate it with this tab's Page.windowOpen event, not unrelated tabs.
        if (this.expectedPopups.delete(request.url())) {
          await this.handlePopupNavigation(route);
          return;
        }
        await route.fallback();
        return;
      }
      const target = frame.page();
      const related = target === this.page || (await target.opener()) === this.page;
      const top = frame === target.mainFrame();
      const popup = target !== this.page;
      if (related && popup && top) {
        await this.handlePopupNavigation(route);
        return;
      }
      if (related && (popup || !this.isDocumentAllowed(request.url(), !top))) {
        this.blocked = true;
        this.pending = {
          url: request.url(),
          canContinue:
            (target === this.page || this.compatible) &&
            top &&
            request.method() === "GET" &&
            this.isWebUrl(request.url())
        };
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.fallback();
  };
  private async handlePopupNavigation(route: Route) {
    const request = route.request();
    this.expectedPopups.delete(request.url());
    const canContinue =
      this.allowPopups && request.method() === "GET" && this.isWebUrl(request.url());
    await route.abort("blockedbyclient");
    if (canContinue && this.isAllowed(request.url())) {
      this.transition = this.page
        .goto(request.url(), { waitUntil: "domcontentloaded" })
        .then(() => undefined)
        .catch(() => {
          this.blocked = true;
        });
    } else {
      this.blocked = true;
      this.pending = { url: request.url(), canContinue };
    }
  }
  private readonly popup = (page: Page) => {
    if (!this.allowPopups) this.blocked = true;
    void page.close().catch(() => undefined);
  };
  private isWebUrl(value: string) {
    try {
      const url = new URL(value);
      return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
    } catch {
      return false;
    }
  }
  private isAllowed(url: string) {
    return isAllowedUrl(url, new Set([...this.allowed, ...this.approved]), this.compatible);
  }
  private isDocumentAllowed(url: string, embedded: boolean) {
    return isAllowedDocument(
      url,
      new Set([...this.allowed, ...this.approved]),
      this.compatible,
      embedded,
      this.page.url()
    );
  }
  public pendingNavigation() {
    if (!this.pending || !this.isWebUrl(this.pending.url)) return null;
    return { hostname: new URL(this.pending.url).hostname, canContinue: this.pending.canContinue };
  }
  public async openLink(value: string) {
    if (!this.isWebUrl(value)) throw new Error("Use an HTTP(S) link without embedded credentials.");
    this.approved.add(new URL(value).hostname);
    this.pending = null;
    this.blocked = false;
    await this.navigate(value);
  }
  public async approveNavigation(hostname: string) {
    const pending = this.pending;
    if (!pending?.canContinue || this.pendingNavigation()?.hostname !== hostname)
      throw new Error("This navigation cannot be resumed safely. Inspect the browser manually.");
    this.approved.add(hostname);
    this.pending = null;
    this.blocked = false;
    // Only a blocked top-level GET may be continued. Never replay a submitted form.
    await this.navigate(pending.url);
  }
  public async installPolicy() {
    this.page.setDefaultTimeout(10000);
    this.page.setDefaultNavigationTimeout(30000);
    await this.page.context().route("**/*", this.route);
    this.page.on("popup", this.popup);
    // Chromium's request-stage interception observes every redirect hop. Playwright
    // routing alone only sees the initial URL of a native HTTP redirect chain.
    this.cdp = await this.page.context().newCDPSession(this.page);
    await this.cdp.send("Page.enable");
    this.cdp.on("Page.windowOpen", (event) => {
      if (event.url && this.isWebUrl(event.url)) this.expectedPopups.add(event.url);
      // Bound state even if a site repeatedly opens blank or blocked windows.
      if (this.expectedPopups.size > 30)
        this.expectedPopups.delete(this.expectedPopups.values().next().value!);
    });
    const tree = await this.cdp.send("Page.getFrameTree");
    this.mainFrameId = tree.frameTree.frame.id;
    this.cdp.on("Fetch.requestPaused", (event) => {
      void this.interceptDocument(event).catch(() => {
        this.blocked = true;
        void this.cdp
          ?.send("Fetch.failRequest", {
            requestId: event.requestId,
            errorReason: "BlockedByClient"
          })
          .catch(() => undefined);
      });
    });
    await this.cdp.send("Fetch.enable", {
      patterns: [{ resourceType: "Document", requestStage: "Request" }]
    });
  }
  private async interceptDocument(event: {
    requestId: string;
    frameId: string;
    request: { url: string; method: string };
  }) {
    const { url, method } = event.request;
    if (!this.isDocumentAllowed(url, event.frameId !== this.mainFrameId)) {
      this.blocked = true;
      this.pending = {
        url,
        canContinue: event.frameId === this.mainFrameId && method === "GET" && this.isWebUrl(url)
      };
      await this.cdp!.send("Fetch.failRequest", {
        requestId: event.requestId,
        errorReason: "BlockedByClient"
      });
    } else await this.cdp!.send("Fetch.continueRequest", { requestId: event.requestId });
  }
  private check() {
    if (this.blocked)
      throw new NavigationBlockedError(
        "Navigation blocked: unexpected destination or popup. Start a new session after reviewing the allowed domains."
      );
    if (this.page.url() !== "about:blank") this.assertAllowed(this.page.url());
  }
  public async navigate(url: string): Promise<PageState> {
    this.assertAllowed(url);
    this.pending = null;
    this.blocked = false;
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    return this.capturePageState();
  }
  public async capturePageState(): Promise<PageState> {
    await this.transition;
    this.transition = undefined;
    this.check();
    for (let attempt = 0; ; attempt++) {
      try {
        const state = await this.captureFrame(this.page.mainFrame(), []);
        this.check();
        return state;
      } catch (error) {
        this.check();
        if (
          attempt >= 2 ||
          !(error instanceof Error) ||
          !/Execution context was destroyed/.test(error.message)
        )
          throw error;
        await this.page
          .waitForLoadState("domcontentloaded", { timeout: 1000 })
          .catch(() => undefined);
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }
    }
  }
  private locator(selector: string): Locator {
    if (!selector.startsWith("survey-frame:")) return this.page.locator(selector);
    const [frames, target] = JSON.parse(selector.slice("survey-frame:".length)) as [
      string[],
      string
    ];
    let scope: Page | FrameLocator = this.page;
    for (const frame of frames) scope = scope.frameLocator(frame);
    return scope.locator(target);
  }
  private async captureFrame(frame: Frame, path: string[]): Promise<PageState> {
    if (path.length > 8) throw new Error("Survey frame nesting exceeds the supported limit.");
    const own = await frame.evaluate(snapshot, this.maxText);
    const qualify = (selector: string) =>
      path.length && selector ? "survey-frame:" + JSON.stringify([path, selector]) : selector;
    const controls = own.controls.map((control) => ({
      ...control,
      selector: qualify(control.selector),
      ...(control.group || path.length ? { group: qualify(control.group || ":root") } : {}),
      ...(control.matrix ? { matrix: qualify(control.matrix) } : {}),
      ...(control.row ? { row: qualify(control.row) } : {})
    }));
    const children: PageState[] = [];
    for (const entry of own.frames ?? []) {
      const element = await frame.locator(entry.selector).elementHandle();
      const child = await element?.contentFrame();
      if (!child) continue;
      if (isVerificationFrame(child.url())) continue;
      // srcdoc/about:blank frames inherit their parent's authorized origin.
      if (!["about:blank", "about:srcdoc"].includes(child.url())) this.assertAllowed(child.url());
      children.push(await this.captureFrame(child, [...path, entry.selector]));
    }
    const all = [own, ...children];
    return {
      ...own,
      documentUrls: [own.url, ...children.flatMap((state) => state.documentUrls ?? [])].filter(
        (url) => !url.startsWith("about:")
      ),
      controls: [...controls, ...children.flatMap((state) => state.controls)],
      text: all
        .map((state) => state.text)
        .join("\n")
        .slice(0, this.maxText),
      hasUnsupported: all.some((state) => state.hasUnsupported),
      hasAuthentication: all.some((state) => state.hasAuthentication),
      hasCaptcha: all.some((state) => state.hasCaptcha),
      captchaDetected: all.some((state) => state.captchaDetected),
      captchaResponsePresent: all
        .filter((state) => state.hasCaptcha || state.captchaDetected)
        .every((state) => state.captchaResponsePresent === true),
      complete: all.some((state) => state.complete),
      validationErrors: all.flatMap((state) => state.validationErrors ?? [])
    };
  }
  public async click(selector: string): Promise<void> {
    this.check();
    const locator = this.locator(selector);
    const href = await locator.getAttribute("href");
    if (href)
      this.assertAllowed(await locator.evaluate((element) => (element as HTMLAnchorElement).href));
    await locator.click();
    this.check();
  }
  public async type(selector: string, value: string): Promise<void> {
    this.check();
    const locator = this.locator(selector);
    await locator.fill(value);
    const actual = await locator.evaluate((element) =>
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
        ? element.value
        : element.textContent
    );
    if (actual !== value) throw new Error("Input verification failed.");
  }
  public async selectDropdown(selector: string, value: string): Promise<void> {
    this.check();
    const locator = this.locator(selector);
    await locator.selectOption(value);
    if ((await locator.inputValue()) !== value) throw new Error("Selection verification failed.");
  }
  public async selectRadio(selector: string): Promise<void> {
    this.check();
    const locator = this.locator(selector);
    if ((await locator.getAttribute("role")) === "radio") {
      if ((await locator.getAttribute("aria-checked")) !== "true") await locator.click();
      if ((await locator.getAttribute("aria-checked")) !== "true")
        throw new Error("Radio verification failed.");
    } else {
      await locator.check();
      if (!(await locator.isChecked())) throw new Error("Radio verification failed.");
    }
  }
  public async setCheckbox(selector: string, checked: boolean): Promise<void> {
    this.check();
    const locator = this.locator(selector);
    if ((await locator.getAttribute("role")) === "checkbox") {
      if (((await locator.getAttribute("aria-checked")) === "true") !== checked)
        await locator.click();
      if (((await locator.getAttribute("aria-checked")) === "true") !== checked)
        throw new Error("Checkbox verification failed.");
    } else {
      await locator.setChecked(checked);
      if ((await locator.isChecked()) !== checked) throw new Error("Checkbox verification failed.");
    }
  }
  public async waitForNavigation(previousUrl: string, timeoutMs = 5000): Promise<NavigationState> {
    if (this.currentUrl() === previousUrl) {
      try {
        await this.page.waitForURL((url) => url.href !== previousUrl, { timeout: timeoutMs });
      } catch (error) {
        if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
      }
    }
    this.check();
    return { previousUrl, url: this.currentUrl(), navigated: this.currentUrl() !== previousUrl };
  }
  public async clickAndDetectNavigation(
    selector: string,
    timeoutMs = 5000
  ): Promise<NavigationState> {
    const previousUrl = this.currentUrl();
    await this.click(selector);
    return this.waitForNavigation(previousUrl, timeoutMs);
  }
  public blockedNavigationHost(): string | undefined {
    return this.pendingNavigation()?.hostname;
  }
  public currentUrl(): string {
    return this.page.url();
  }
  public async screenshot(filePath: string) {
    await this.page.screenshot({ path: filePath, fullPage: false });
  }
  public async close(): Promise<void> {
    await this.cdp?.detach().catch(() => undefined);
    await this.page.context().unroute("**/*", this.route);
    this.page.off("popup", this.popup);
    const context = this.page.context();
    if (this.ownsPage) await this.page.close();
    if (this.ownsContext) await context.close();
  }
  private assertAllowed(url: string) {
    if (!this.isAllowed(url)) {
      this.blocked = true;
      this.pending = { url, canContinue: this.isWebUrl(url) };
      throw new NavigationBlockedError(
        "Navigation blocked: target is not on the configured allowlist."
      );
    }
  }
}
export function isLoopbackCdpEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
function pageMatchesUrl(pageUrl: string, targetUrl: string): boolean {
  try {
    const page = new URL(pageUrl),
      target = new URL(targetUrl);
    return page.origin === target.origin && page.pathname === target.pathname;
  } catch {
    return false;
  }
}
