import { expect, it, vi } from "vitest";
import { SurveyRunner } from "../../src/runtime/survey-runner.js";
import { settingsSchema } from "../../src/config/app-settings.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import { AnswerDecisionEngine } from "../../src/decision/answer-engine.js";
import { NoCostProvider } from "../../src/providers/no-cost-provider.js";
import type { BrowserSession, BrowserAutomationDriver } from "../../src/browser/types.js";

it.each([false, true])(
  "keeps CAPTCHA review paused when notification failure is %s",
  async (fails) => {
    const store = new SqliteStore(":memory:");
    const engine = new AnswerDecisionEngine(store, new NoCostProvider());
    const decide = vi.spyOn(engine, "decide");
    const page = {
      url: "https://survey.test/",
      title: "Survey",
      text: "Verify you are human",
      controls: [],
      hasCaptcha: true
    };
    const session = {
      navigate: async () => page,
      capturePageState: async () => page,
      currentUrl: () => page.url,
      close: async () => {}
    } as unknown as BrowserSession;
    const driver = {
      createSession: async () => session,
      close: async () => {}
    } as unknown as BrowserAutomationDriver;
    const notify = vi.fn(async () => {
      if (fails) throw new Error("offline");
    });
    const runner = new SurveyRunner(
      store,
      () => driver,
      () => engine,
      ".",
      notify
    );
    try {
      await runner.start(
        settingsSchema.parse({
          platform: "generic",
          allowedDomains: ["survey.test"],
          startUrl: page.url
        })
      );
      await runner.idle();
      expect(runner.state()).toMatchObject({
        run: { status: "review" },
        reason: "captcha_detected"
      });
      expect(notify).toHaveBeenCalledExactlyOnceWith({
        reason: "captcha_detected",
        host: "survey.test"
      });
      if (fails) expect(runner.state().run?.message).toContain("Phone alert failed");
      expect(decide).not.toHaveBeenCalled();
    } finally {
      await runner.stop();
      store.close();
    }
  }
);
