import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
import { SurveyRunner } from "../../src/runtime/survey-runner.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import { AnswerDecisionEngine } from "../../src/decision/answer-engine.js";
import { settingsSchema } from "../../src/config/app-settings.js";
import type { ProviderQuestion } from "../../src/providers/types.js";
it("skips unanswerable and blocked surveys, answers an uncertain objective question, and keeps running without approval", async () => {
  const visits: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    visits.push(path);
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (path === "/surveys")
      return void response.end(
        [1, 2, 3]
          .map(
            (n) =>
              `<article data-survey-id="${n}">${100 - n} SB 5 min <a href="/survey${n}">Start survey</a></article>`
          )
          .join("")
      );
    if (path === "/survey1")
      return void response.end(
        '<label for="q">What was your income last year?</label><input id="q" type="number"><button>Next</button>'
      );
    if (path === "/survey2") {
      response.writeHead(302, { location: "https://outside.invalid/survey" });
      return void response.end();
    }
    if (path === "/survey3")
      return void response.end(
        '<fieldset><legend>What is two plus two?</legend><label><input type="radio" name="q" value="4">4</label><label><input type="radio" name="q" value="5">5</label></fieldset><button onclick="location.href=\'/done\'">Submit</button>'
      );
    response.end("<h1 data-survey-complete>Survey complete</h1>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const directory = await mkdtemp(join(tmpdir(), "swag-recovery-"));
  const store = new SqliteStore(join(directory, "agent.sqlite"));
  const notify = vi.fn(async () => undefined);
  const provider = {
    decide: vi.fn(async (q: ProviderQuestion) =>
      q.question.includes("income")
        ? { confidence: 0, reason: "No personal income is available" }
        : {
            selectedOption: "4",
            basis: "objective" as const,
            confidence: 0.4,
            reason: "Best supported arithmetic answer"
          }
    )
  };
  const runner = new SurveyRunner(
    store,
    (config) =>
      new PlaywrightChromiumBrowser({ allowedDomains: config.allowedDomains, headless: true }),
    () => new AnswerDecisionEngine(store, provider, 0.9, undefined, true),
    directory,
    notify
  );
  try {
    await runner.start(
      settingsSchema.parse({
        platform: "swagbucks",
        provider: "chatgpt_browser",
        continuousSurveys: true,
        autonomousRecovery: true,
        autoSubmit: true,
        startUrl: `http://127.0.0.1:${address.port}/surveys`,
        allowedDomains: ["127.0.0.1"],
        surveyHostCatalog: false,
        stepDelayMs: 250,
        offerPollSeconds: 15
      })
    );
    await expect
      .poll(() => runner.state().run?.message, { timeout: 20000 })
      .toContain("Waiting for new eligible surveys");
    expect(visits).toContain("/done");
    expect(provider.decide.mock.calls.filter(([q]) => q.question.includes("income"))).toHaveLength(
      2
    );
    expect(store.stats().answers).toBe(1);
    expect(notify).not.toHaveBeenCalled();
    expect(runner.state().run?.status).toBe("running");
    runner.pause();
    await runner.idle();
  } finally {
    await runner.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 25000);
