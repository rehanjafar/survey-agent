import { expect, it } from "vitest";
import { swagbucksOutcome } from "../../src/platforms/swagbucks/outcome.js";
import type { PageState } from "../../src/browser/types.js";
import { settingsSchema } from "../../src/config/app-settings.js";
const page: PageState = {
  url: "https://www.swagbucks.com/surveys",
  title: "Surveys",
  text: "",
  controls: []
};
it.each([
  ["You did not qualify for this survey.", "survey_screened_out"],
  ["Not every survey can be a winner!", "survey_screened_out"],
  ["This survey is now full.", "survey_unavailable"],
  ["Survey reached its quota.", "survey_unavailable"],
  ["Why do some surveys disqualify people?", undefined],
  ["Survey complete", undefined]
])("recognizes terminal message %s", (text, outcome) => {
  expect(swagbucksOutcome({ ...page, text })).toBe(outcome);
});
it("defaults new installations to Swagbucks while preserving saved platform choices", () => {
  expect(settingsSchema.parse({})).toMatchObject({
    platform: "swagbucks",
    startUrl: "https://www.swagbucks.com/surveys",
    allowedDomains: ["swagbucks.com", "www.swagbucks.com"],
    rankBy: "reward_per_minute"
  });
  expect(
    settingsSchema.parse({
      platform: "eureka",
      startUrl: "https://eurekasurveys.com/surveys",
      allowedDomains: ["eurekasurveys.com"]
    }).platform
  ).toBe("eureka");
});
