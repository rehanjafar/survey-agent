import { expect, it } from "vitest";
import { settingsSchema, swagbucksSettings } from "../../src/config/app-settings.js";
import { chromeLoginArguments, chromeProfile } from "../../src/browser/chrome-login.js";
it("defaults a fresh app to autonomous Swagbucks in Chrome", () => {
  expect(swagbucksSettings()).toMatchObject({
    platform: "swagbucks",
    startUrl: "https://www.swagbucks.com/surveys",
    provider: "chatgpt_browser",
    browser: "chrome",
    autonomousRecovery: true,
    continuousSurveys: true,
    autoSubmit: true,
    autoAcceptConsent: true
  });
});
it("upgrades old platform/manual defaults once while preserving filters and authorized hosts", () => {
  const settings = swagbucksSettings({
    platform: "eureka",
    startUrl: "https://eurekasurveys.com/",
    allowedDomains: ["authorized.test"],
    minimumHourlyReward: 600,
    maxDurationMinutes: 20
  });
  expect(settings).toMatchObject({
    platform: "swagbucks",
    provider: "chatgpt_browser",
    minimumHourlyReward: 600,
    maxDurationMinutes: 20
  });
  expect(settings.allowedDomains).toContain("authorized.test");
  expect(swagbucksSettings({ ...settings, autoSubmit: false, browser: "chromium" })).toMatchObject({
    autoSubmit: false,
    browser: "chromium"
  });
});
it("retains a configured ChatGPT plan connection", () => {
  expect(
    swagbucksSettings({ provider: "chatgpt_plan", chatgptModel: "configured-model" })
  ).toMatchObject({ provider: "chatgpt_plan", chatgptModel: "configured-model" });
  expect(() => settingsSchema.parse({ browser: "unrecognized" })).toThrow();
});
it.each(["swagbucks", "chatgpt"] as const)(
  "uses the same isolated %s Chrome profile for manual sign-in and automation",
  (target) => {
    const args = chromeLoginArguments("/tmp/test agent", target);
    expect(args[0]).toBe(`--user-data-dir=${chromeProfile("/tmp/test agent", target)}`);
    expect(args).toHaveLength(3);
    expect(args.join(" ")).not.toMatch(/remote-debugging|disable|automation|webdriver/);
    expect(args.at(-1)).toBe(
      target === "chatgpt" ? "https://chatgpt.com/" : "https://www.swagbucks.com/surveys"
    );
  }
);
