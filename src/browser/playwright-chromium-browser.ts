import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, Route, CDPSession } from "playwright";
import { isAllowedUrl } from "./url-policy.js";
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
      this.context = await chromium.launchPersistentContext(this.options.userDataDirectory, {
        headless: this.options.headless ?? true,
        serviceWorkers: "block",
        acceptDownloads: false
      });
    } else {
      this.browser = await chromium.launch({ headless: this.options.headless ?? true });
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
      !attached
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
  public constructor(
    private readonly page: Page,
    private readonly allowed: ReadonlySet<string>,
    private readonly maxText: number,
    private readonly ownsContext: boolean,
    private readonly ownsPage: boolean
  ) {}
  private readonly route = async (route: Route) => {
    const request = route.request();
    if (request.isNavigationRequest()) {
      const target = request.frame().page();
      const related = target === this.page || (await target.opener()) === this.page;
      if (related && (target !== this.page || !this.isAllowed(request.url()))) {
        this.blocked = true;
        this.pending = {
          url: request.url(),
          canContinue:
            target === this.page &&
            request.frame() === this.page.mainFrame() &&
            request.method() === "GET" &&
            this.isWebUrl(request.url())
        };
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.fallback();
  };
  private readonly popup = (page: Page) => {
    this.blocked = true;
    this.pending = null;
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
    return isAllowedUrl(url, new Set([...this.allowed, ...this.approved]));
  }
  public pendingNavigation() {
    if (!this.pending || !this.isWebUrl(this.pending.url)) return null;
    return { hostname: new URL(this.pending.url).hostname, canContinue: this.pending.canContinue };
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
    if (!this.isAllowed(url)) {
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
      throw new Error(
        "Unexpected navigation or popup was blocked. Start a new session after reviewing the allowed domains."
      );
    if (this.page.url() !== "about:blank") this.assertAllowed(this.page.url());
  }
  public async navigate(url: string): Promise<PageState> {
    this.assertAllowed(url);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    return this.capturePageState();
  }
  public async capturePageState(): Promise<PageState> {
    this.check();
    return this.page.evaluate(snapshot, this.maxText);
  }
  public async click(selector: string): Promise<void> {
    this.check();
    const locator = this.page.locator(selector);
    const href = await locator.getAttribute("href");
    if (href) this.assertAllowed(new URL(href, this.page.url()).href);
    await locator.click();
    this.check();
  }
  public async type(selector: string, value: string): Promise<void> {
    this.check();
    const locator = this.page.locator(selector);
    await locator.fill(value);
    if ((await locator.inputValue()) !== value) throw new Error("Input verification failed.");
  }
  public async selectDropdown(selector: string, value: string): Promise<void> {
    this.check();
    const locator = this.page.locator(selector);
    await locator.selectOption(value);
    if ((await locator.inputValue()) !== value) throw new Error("Selection verification failed.");
  }
  public async selectRadio(selector: string): Promise<void> {
    this.check();
    const locator = this.page.locator(selector);
    await locator.check();
    if (!(await locator.isChecked())) throw new Error("Radio verification failed.");
  }
  public async setCheckbox(selector: string, checked: boolean): Promise<void> {
    this.check();
    const locator = this.page.locator(selector);
    await locator.setChecked(checked);
    if ((await locator.isChecked()) !== checked) throw new Error("Checkbox verification failed.");
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
      throw new Error("Navigation blocked: target is not on the configured allowlist.");
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
