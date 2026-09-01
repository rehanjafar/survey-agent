import { describe, expect, it } from "vitest";

import type {
  BrowserSession,
  InteractiveControl,
  NavigationState,
  PageState
} from "../../src/browser/index.js";
import {
  EurekaSurveyPlatformAdapter,
  parseRewardCents,
  rankOffers
} from "../../src/platforms/eureka/index.js";
import type {
  EurekaAuditEvent,
  EurekaAuditLogger,
  EurekaOffer
} from "../../src/platforms/eureka/index.js";

class MemoryAuditLogger implements EurekaAuditLogger {
  public readonly events: EurekaAuditEvent[] = [];

  public async record(event: EurekaAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

class FakeBrowserSession implements BrowserSession {
  public constructor(
    private readonly state: PageState,
    private readonly navigation: NavigationState = {
      previousUrl: "https://eurekasurveys.com/surveys",
      url: "https://eurekasurveys.com/survey/high",
      navigated: true
    }
  ) {}

  public async capturePageState(): Promise<PageState> {
    return this.state;
  }

  public async clickAndDetectNavigation(): Promise<NavigationState> {
    return this.navigation;
  }

  public async click(): Promise<void> {}
  public async close(): Promise<void> {}
  public currentUrl(): string {
    return this.state.url;
  }
  public async navigate(): Promise<PageState> {
    return this.state;
  }
  public async selectDropdown(): Promise<void> {}
  public async selectRadio(): Promise<void> {}
  public async setCheckbox(): Promise<void> {}
  public async type(): Promise<void> {}
  public async waitForNavigation(): Promise<NavigationState> {
    return this.navigation;
  }
}

const offerControl = (label: string, selector: string, disabled = false): InteractiveControl => ({
  kind: "button",
  selector,
  id: selector.slice(1),
  name: "",
  label,
  ariaLabel: "",
  placeholder: "",
  value: "",
  href: "",
  checked: false,
  disabled,
  required: false,
  options: []
});

const pageState = (text: string, controls: readonly InteractiveControl[] = []): PageState => ({
  url: "https://eurekasurveys.com/surveys",
  title: "Eureka Surveys",
  text,
  controls
});

describe("EurekaSurveyPlatformAdapter", () => {
  it("parses dollar and cent rewards", () => {
    expect(parseRewardCents("Earn $1.25")).toBe(125);
    expect(parseRewardCents("Earn 75¢")).toBe(75);
    expect(parseRewardCents("Earn 30 cents")).toBe(30);
    expect(parseRewardCents("No reward shown")).toBeNull();
  });

  it("ranks the highest enabled positive reward and preserves DOM order for ties", () => {
    const offers: EurekaOffer[] = [
      {
        id: "first",
        selector: "#first",
        title: "First",
        rewardCents: 100,
        durationMinutes: null,
        enabled: true
      },
      {
        id: "second",
        selector: "#second",
        title: "Second",
        rewardCents: 250,
        durationMinutes: null,
        enabled: true
      },
      {
        id: "third",
        selector: "#third",
        title: "Third",
        rewardCents: 250,
        durationMinutes: null,
        enabled: true
      },
      {
        id: "disabled",
        selector: "#disabled",
        title: "Disabled",
        rewardCents: 900,
        durationMinutes: null,
        enabled: false
      }
    ];

    expect(rankOffers(offers).map((offer) => offer.id)).toEqual(["second", "third", "first"]);
  });

  it("excludes disabled and malformed cards before selecting the highest offer", async () => {
    const logger = new MemoryAuditLogger();
    const adapter = new EurekaSurveyPlatformAdapter(
      new FakeBrowserSession(
        pageState("Available surveys", [
          offerControl("Low reward — 75¢ — 4 minutes", "#low"),
          offerControl("High reward — $1.25 — 9 minutes", "#high"),
          offerControl("Disabled — $9.00", "#disabled", true),
          offerControl("No amount", "#malformed")
        ])
      ),
      { startUrl: "https://eurekasurveys.com/surveys", auditLogger: logger }
    );

    await expect(adapter.discoverOffers()).resolves.toMatchObject({
      status: "ready",
      selectedOffer: { id: "high", rewardCents: 125 },
      offers: [{ id: "high" }, { id: "low" }]
    });
    expect(logger.events[0]).toMatchObject({ event: "offers_discovered", offerCount: 2 });
  });

  it.each([
    ["Please complete the CAPTCHA", "captcha_detected"],
    ["Log in with your password", "authentication_required"],
    ["No surveys are currently available", "no_offers"]
  ])("stops for %s", async (text, reason) => {
    const logger = new MemoryAuditLogger();
    const adapter = new EurekaSurveyPlatformAdapter(new FakeBrowserSession(pageState(text)), {
      startUrl: "https://eurekasurveys.com/surveys",
      auditLogger: logger
    });

    await expect(adapter.discoverOffers()).resolves.toEqual({ status: "review", reason });
    expect(logger.events[0]).toMatchObject({ event: "review_required", reason });
  });

  it("stops when an offer leaves the configured host", async () => {
    const logger = new MemoryAuditLogger();
    const session = new FakeBrowserSession(
      pageState("Available", [offerControl("Survey — $2.00", "#offer")]),
      {
        previousUrl: "https://eurekasurveys.com/surveys",
        url: "https://survey-provider.example/question/1",
        navigated: true
      }
    );
    const adapter = new EurekaSurveyPlatformAdapter(session, {
      startUrl: "https://eurekasurveys.com/surveys",
      auditLogger: logger
    });

    await expect(adapter.openHighestRewardOffer()).resolves.toEqual({
      status: "review",
      reason: "external_redirect"
    });
  });
});
