import { expect, it } from "vitest";
import { settingsSchema } from "../../src/config/app-settings.js";
import { effectiveSurveyDomains } from "../../src/config/survey-hosts.js";
import { isAllowedUrl, isAllowedDocument } from "../../src/browser/url-policy.js";
it("adds bounded provider rules to existing panel settings without approving arbitrary sites", () => {
  const rules = new Set(
    effectiveSurveyDomains(
      settingsSchema.parse({ platform: "prolific", allowedDomains: ["app.prolific.com"] })
    )
  );
  expect(isAllowedUrl("https://university.qualtrics.com/jfe/form/SV_test", rules)).toBe(true);
  expect(isAllowedUrl("https://router.samplicio.us/study", rules)).toBe(true);
  expect(isAllowedUrl("https://qualtrics.com.attacker.test/", rules)).toBe(false);
  expect(isAllowedUrl("https://unlisted.test/", rules)).toBe(false);
  expect(isAllowedUrl("https://127.0.0.1/", rules)).toBe(false);
});
it("supports catalog opt-out and leaves generic host scopes explicit", () => {
  for (const settings of [
    { platform: "generic" },
    { platform: "eureka", surveyHostCatalog: false }
  ])
    expect(
      effectiveSurveyDomains(
        settingsSchema.parse({ ...settings, allowedDomains: ["example.test"] })
      )
    ).toEqual(["example.test"]);
});
it("loads verification frames only as embedded content of an authorized page", () => {
  const rules = new Set(["example.test"]);
  for (const url of [
    "https://challenges.cloudflare.com/a",
    "https://newassets.hcaptcha.com/captcha",
    "https://www.recaptcha.net/recaptcha/api2/anchor"
  ]) {
    expect(isAllowedDocument(url, rules, true, true, "https://example.test/")).toBe(true);
    expect(isAllowedDocument(url, rules, true, false, "https://example.test/")).toBe(false);
    expect(isAllowedDocument(url, rules, true, true, "https://evil.test/")).toBe(false);
  }
});
