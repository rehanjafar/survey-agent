import { describe, expect, it, vi } from "vitest";
import type { InteractiveControl, BrowserSession, PageState } from "../../src/browser/types.js";
import {
  PanelSurveyAdapter,
  parsePanelOffer,
  rankPanelOffers,
  type PanelOptions
} from "../../src/platforms/panels/panel-adapter.js";
const options: PanelOptions = {
  platform: "prolific",
  startUrl: "https://app.prolific.com/studies",
  allowedHosts: ["app.prolific.com", "study.test"],
  currency: "USD",
  minimumHourlyReward: 0,
  maxDurationMinutes: 60
};
const control = (text: string, id = text): InteractiveControl => ({
  kind: "button",
  selector: `#${id}`,
  id,
  label: "View study",
  offerText: text,
  ariaLabel: "",
  name: "",
  placeholder: "",
  value: "",
  href: "",
  checked: false,
  disabled: false,
  required: false,
  options: []
});
const state = (controls: InteractiveControl[], url = options.startUrl): PageState => ({
  url,
  title: "Studies",
  text: "Available studies",
  controls
});

describe("platform offer ranking", () => {
  it("ranks hourly value over total reward and ignores an advertised hourly number as total", () => {
    const offers = rankPanelOffers(
      [control("Long study $5.00 50 minutes"), control("Short study $2.00 $24.00/hr 5 minutes")],
      options
    );
    expect(offers.map((offer) => offer.reward)).toEqual([2, 5]);
    expect(offers[0]?.hourlyReward).toBe(24);
  });
  it("keeps GBP and USD separate", () => {
    expect(parsePanelOffer(control("Study £4.00 10 minutes"), options)).toBeUndefined();
    expect(
      parsePanelOffer(control("Study £4.00 10 minutes"), { ...options, currency: "GBP" })
    ).toMatchObject({ reward: 4, hourlyReward: 24, unit: "GBP" });
    expect(parsePanelOffer(control("Study £4.00 $5.00 10 minutes"), options)).toBeUndefined();
  });
  it("uses points for Branded and respects duration and minimum-rate filters", () => {
    const branded = {
      ...options,
      platform: "branded" as const,
      minimumHourlyReward: 600,
      maxDurationMinutes: 15
    };
    expect(
      rankPanelOffers(
        [
          control("Survey 100 points 5 min"),
          control("Survey 100 pts 20 min"),
          control("Survey 10 points 5 min")
        ],
        branded
      )
    ).toMatchObject([{ reward: 100, unit: "points", hourlyReward: 1200 }]);
  });
  it.each([
    "Study $3.00",
    "Study $3.00 0 minutes",
    "Study $3.00 10 minutes full",
    "Referral bonus $20 5 minutes",
    "Study $3 $5 10 minutes",
    "Study $3 5 minutes 10 minutes"
  ])("rejects missing, ambiguous or unavailable metadata: %s", (text) => {
    expect(parsePanelOffer(control(text), options)).toBeUndefined();
  });
  it("does not guess between multiple card actions or choose disabled offers", () => {
    expect(
      rankPanelOffers(
        [
          control("Study $2 5 min", "one"),
          control("Study $2 5 min", "two"),
          { ...control("Other $3 5 min"), disabled: true }
        ],
        options
      )
    ).toEqual([]);
  });
});

it("follows a study detail page to an external host, then excludes attempted offers", async () => {
  const listing = state([control("Study $2 5 min", "offer")]);
  const detail = state(
    [{ ...control("", "start"), label: "Start now" }],
    "https://app.prolific.com/studies/one"
  );
  const external = state([], "https://study.test/question");
  const capturePageState = vi
    .fn()
    .mockResolvedValueOnce(listing)
    .mockResolvedValueOnce(detail)
    .mockResolvedValueOnce(external)
    .mockResolvedValue(listing);
  const clickAndDetectNavigation = vi.fn(async () => ({
    navigated: true,
    previousUrl: listing.url,
    url: external.url
  }));
  const adapter = new PanelSurveyAdapter(
    { capturePageState, clickAndDetectNavigation } as unknown as BrowserSession,
    options
  );
  await expect(adapter.openBestOffer()).resolves.toMatchObject({
    status: "opened",
    url: external.url
  });
  expect(clickAndDetectNavigation.mock.calls).toEqual([["#offer"], ["#start"]]);
  await expect(adapter.discoverOffers()).resolves.toMatchObject({
    status: "review",
    reason: "no_matching_offers"
  });
});

it.each([
  ["https://unknown.test/q", "Question", "external_redirect"],
  ["https://study.test/q", "CAPTCHA", "captcha_detected"],
  ["https://study.test/q", "Sign in", "authentication_required"]
])("checks destination %s", async (url, text, reason) => {
  const session = {
    capturePageState: vi
      .fn()
      .mockResolvedValueOnce(state([control("Study $2 5 min")]))
      .mockResolvedValue({ ...state([], url), text }),
    clickAndDetectNavigation: vi.fn(async () => ({}))
  } as unknown as BrowserSession;
  await expect(new PanelSurveyAdapter(session, options).openBestOffer()).resolves.toEqual({
    status: "review",
    reason
  });
});

it("does not repeat a start click when the study detail page stays unchanged", async () => {
  const detail = state(
    [{ ...control("", "start"), label: "Start now" }],
    "https://app.prolific.com/studies/one"
  );
  const session = {
    capturePageState: vi
      .fn()
      .mockResolvedValueOnce(state([control("Study $2 5 min", "offer")]))
      .mockResolvedValue(detail),
    clickAndDetectNavigation: vi.fn(async () => ({}))
  } as unknown as BrowserSession;
  await expect(new PanelSurveyAdapter(session, options).openBestOffer()).resolves.toEqual({
    status: "review",
    reason: "study_handoff_did_not_advance"
  });
  expect(session.clickAndDetectNavigation).toHaveBeenCalledTimes(2);
});
