import { expect, it, vi } from "vitest";
import { interpretSurveyOffer } from "../../src/decision/survey-offers.js";
import { PanelSurveyAdapter } from "../../src/platforms/panels/panel-adapter.js";
import { settingsSchema } from "../../src/config/app-settings.js";
import type { BrowserSession, PageState, InteractiveControl } from "../../src/browser/types.js";
const settings = settingsSchema.parse({ minimumHourlyReward: 600, maxDurationMinutes: 10 });
const card: InteractiveControl = {
  kind: "button",
  selector: "#observed",
  id: "",
  name: "",
  label: "Explore survey",
  ariaLabel: "",
  placeholder: "",
  value: "",
  href: "https://www.swagbucks.com/survey?id=private",
  checked: false,
  disabled: false,
  required: false,
  options: [],
  offerId: "stable",
  offerText: "80 SB, estimated duration: 5 short minutes"
};
const page: PageState = {
  url: settings.startUrl,
  title: "Surveys",
  text: "Unrelated private page text",
  controls: [card]
};
function panel() {
  return new PanelSurveyAdapter({} as BrowserSession, {
    ...settings,
    platform: "swagbucks",
    allowedHosts: settings.allowedDomains
  });
}
const label = `1: ${card.label} — ${card.offerText}`;
it("binds a model-interpreted offer to an observed card without sending URLs or unrelated text", async () => {
  const provider = {
    decide: vi.fn(async () => ({
      selectedOption: label,
      value: JSON.stringify({ reward: 80, minutes: 5, unit: "SB" }),
      confidence: 1,
      reason: ""
    }))
  };
  expect(await interpretSurveyOffer(page, panel(), settings, provider, 0.9)).toMatchObject({
    selector: "#observed",
    key: "swagbucks:stable",
    hourlyReward: 960
  });
  expect(JSON.stringify(provider.decide.mock.calls)).not.toMatch(/private|#observed|https:/);
});
it.each([
  { reward: 800, minutes: 5, unit: "SB" },
  { reward: 80, minutes: 50, unit: "SB" },
  { reward: 5, minutes: 80, unit: "SB" },
  { reward: 80, minutes: 5, unit: "USD" }
])("rejects fabricated values, wrong units and ineligible durations: %j", async (amounts) => {
  expect(
    await interpretSurveyOffer(
      page,
      panel(),
      settings,
      {
        decide: async () => ({
          selectedOption: label,
          value: JSON.stringify(amounts),
          confidence: 1,
          reason: ""
        })
      },
      0.9
    )
  ).toBeUndefined();
});
it.each(["attempted", "known-ineligible", "shopping", "duplicate"])(
  "does not open %s cards",
  async (kind) => {
    const adapter = panel();
    if (kind === "attempted") adapter.markAttempted("swagbucks:stable");
    const control = {
      ...card,
      ...(kind === "known-ineligible" ? { offerText: "80 SB 50 min" } : {}),
      ...(kind === "shopping" ? { offerText: "Shop 80 SB in 5 short minutes" } : {})
    };
    const provider = {
      decide: vi.fn(async () => ({
        selectedOption: label,
        value: JSON.stringify({ reward: 80, minutes: 5, unit: "SB" }),
        confidence: 1,
        reason: ""
      }))
    };
    expect(
      await interpretSurveyOffer(
        {
          ...page,
          controls:
            kind === "duplicate" ? [control, { ...control, selector: "#duplicate" }] : [control]
        },
        adapter,
        settings,
        provider,
        0.9
      )
    ).toBeUndefined();
    if (kind !== "duplicate") expect(provider.decide).not.toHaveBeenCalled();
  }
);
