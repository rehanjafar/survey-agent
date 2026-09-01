import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

import { isAllowedUrl } from "./url-policy.js";
import type {
  BrowserAutomationDriver,
  BrowserSession,
  BrowserSessionOptions,
  ChromiumBrowserOptions,
  InteractiveControl,
  InteractiveControlKind,
  NavigationState,
  PageState
} from "./types.js";

const DEFAULT_MAX_PAGE_TEXT_LENGTH = 12_000;

export class PlaywrightChromiumBrowser implements BrowserAutomationDriver {
  private browser: Browser | undefined;
  private sharedContext: BrowserContext | undefined;
  private readonly allowedDomains: ReadonlySet<string>;
  private readonly headless: boolean;
  private readonly maxPageTextLength: number;

  public constructor(options: ChromiumBrowserOptions = {}) {
    this.allowedDomains = new Set(
      options.allowedDomains?.map((domain) => domain.toLowerCase()) ?? []
    );
    this.headless = options.headless ?? true;
    this.maxPageTextLength = options.maxPageTextLength ?? DEFAULT_MAX_PAGE_TEXT_LENGTH;
  }

  public async launch(): Promise<void> {
    if (this.browser) {
      return;
    }

    this.browser = await chromium.launch({ headless: this.headless });
  }

  public async createSession(options: BrowserSessionOptions = {}): Promise<BrowserSession> {
    await this.launch();

    const reuseContext = options.reuseContext ?? true;
    const context = reuseContext
      ? await this.getOrCreateSharedContext()
      : await this.getBrowser().newContext();
    const page = await context.newPage();

    return new PlaywrightBrowserSession(
      page,
      this.allowedDomains,
      this.maxPageTextLength,
      !reuseContext
    );
  }

  public async close(): Promise<void> {
    await this.sharedContext?.close();
    this.sharedContext = undefined;
    await this.browser?.close();
    this.browser = undefined;
  }

  private getBrowser(): Browser {
    if (!this.browser) {
      throw new Error("Browser has not been launched.");
    }

    return this.browser;
  }

  private async getOrCreateSharedContext(): Promise<BrowserContext> {
    if (!this.sharedContext) {
      this.sharedContext = await this.getBrowser().newContext();
    }

    return this.sharedContext;
  }
}

class PlaywrightBrowserSession implements BrowserSession {
  public constructor(
    private readonly page: Page,
    private readonly allowedDomains: ReadonlySet<string>,
    private readonly maxPageTextLength: number,
    private readonly ownsContext: boolean
  ) {}

  public async navigate(url: string): Promise<PageState> {
    this.assertUrlAllowed(url);
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    return this.capturePageState();
  }

  public async capturePageState(): Promise<PageState> {
    return this.page.evaluate((maxPageTextLength) => {
      const selectorFor = (element: Element): string => {
        if (element.id) {
          return `#${CSS.escape(element.id)}`;
        }

        const parent = element.parentElement;
        const tagName = element.tagName.toLowerCase();
        if (!parent) {
          return tagName;
        }

        const siblingIndex = Array.from(parent.children)
          .filter((sibling) => sibling.tagName === element.tagName)
          .indexOf(element);

        return `${selectorFor(parent)} > ${tagName}:nth-of-type(${siblingIndex + 1})`;
      };

      const labelFor = (
        element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      ): string => {
        const associatedLabels = Array.from(element.labels ?? []).map((label) =>
          label.innerText.trim()
        );
        const closestLabel = element.closest("label")?.innerText.trim();
        return [
          ...associatedLabels,
          closestLabel,
          element.getAttribute("aria-label"),
          element.getAttribute("placeholder")
        ]
          .filter((value): value is string => Boolean(value))
          .join(" ");
      };

      const kindFor = (element: Element): InteractiveControlKind => {
        if (element instanceof HTMLButtonElement) {
          return "button";
        }
        if (element instanceof HTMLSelectElement) {
          return "select";
        }
        if (element instanceof HTMLTextAreaElement) {
          return "textarea";
        }
        if (!(element instanceof HTMLInputElement)) {
          return "other";
        }

        switch (element.type) {
          case "checkbox":
            return "checkbox";
          case "radio":
            return "radio";
          case "number":
            return "number";
          case "button":
          case "submit":
          case "reset":
            return "button";
          default:
            return "text";
        }
      };

      const controls = Array.from(
        document.querySelectorAll<
          HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
        >("input, select, textarea, button")
      )
        .filter((element) => element.type !== "hidden")
        .map((element): InteractiveControl => {
          const isSelect = element instanceof HTMLSelectElement;
          const labelledElement = element instanceof HTMLButtonElement ? undefined : element;

          return {
            kind: kindFor(element),
            selector: selectorFor(element),
            id: element.id,
            name: element.getAttribute("name") ?? "",
            label: labelledElement ? labelFor(labelledElement) : element.innerText.trim(),
            ariaLabel: element.getAttribute("aria-label") ?? "",
            placeholder: element.getAttribute("placeholder") ?? "",
            value: element.value,
            checked: element instanceof HTMLInputElement ? element.checked : false,
            disabled: element.disabled,
            required: "required" in element && element.required,
            options: isSelect
              ? Array.from(element.options).map((option) => ({
                  label: option.label,
                  value: option.value,
                  disabled: option.disabled,
                  selected: option.selected
                }))
              : []
          };
        });

      return {
        url: window.location.href,
        title: document.title,
        text: document.body?.innerText.trim().slice(0, maxPageTextLength) ?? "",
        controls
      };
    }, this.maxPageTextLength);
  }

  public async click(selector: string): Promise<void> {
    await this.page.locator(selector).click();
  }

  public async type(selector: string, value: string): Promise<void> {
    await this.page.locator(selector).fill(value);
  }

  public async selectDropdown(selector: string, value: string): Promise<void> {
    await this.page.locator(selector).selectOption(value);
  }

  public async selectRadio(selector: string): Promise<void> {
    await this.page.locator(selector).check();
  }

  public async setCheckbox(selector: string, checked: boolean): Promise<void> {
    const control = this.page.locator(selector);
    if (checked) {
      await control.check();
      return;
    }

    await control.uncheck();
  }

  public async waitForNavigation(previousUrl: string, timeoutMs = 5_000): Promise<NavigationState> {
    if (this.currentUrl() === previousUrl) {
      try {
        await this.page.waitForURL((url) => url.href !== previousUrl, { timeout: timeoutMs });
      } catch {
        // A timeout means the action did not navigate; callers receive that deterministic result.
      }
    }

    return {
      previousUrl,
      url: this.currentUrl(),
      navigated: this.currentUrl() !== previousUrl
    };
  }

  public async clickAndDetectNavigation(
    selector: string,
    timeoutMs = 5_000
  ): Promise<NavigationState> {
    const previousUrl = this.currentUrl();
    await this.click(selector);
    return this.waitForNavigation(previousUrl, timeoutMs);
  }

  public currentUrl(): string {
    return this.page.url();
  }

  public async close(): Promise<void> {
    const context = this.page.context();
    await this.page.close();
    if (this.ownsContext) {
      await context.close();
    }
  }

  private assertUrlAllowed(url: string): void {
    if (this.allowedDomains.size > 0 && !isAllowedUrl(url, this.allowedDomains)) {
      throw new Error(`Navigation blocked: ${url} is not on the configured allowlist.`);
    }
  }
}
