import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, Route } from "playwright";
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
      if (related && (target !== this.page || !isAllowedUrl(request.url(), this.allowed))) {
        this.blocked = true;
        await route.abort("blockedbyclient");
        return;
      }
    }
    await route.fallback();
  };
  private readonly popup = (page: Page) => {
    this.blocked = true;
    void page.close().catch(() => undefined);
  };
  public async installPolicy() {
    this.page.setDefaultTimeout(10000);
    this.page.setDefaultNavigationTimeout(30000);
    await this.page.context().route("**/*", this.route);
    this.page.on("popup", this.popup);
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
    await this.page.context().unroute("**/*", this.route);
    this.page.off("popup", this.popup);
    const context = this.page.context();
    if (this.ownsPage) await this.page.close();
    if (this.ownsContext) await context.close();
  }
  private assertAllowed(url: string) {
    if (!isAllowedUrl(url, this.allowed))
      throw new Error("Navigation blocked: target is not on the configured allowlist.");
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
