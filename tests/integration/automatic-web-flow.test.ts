import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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
it("loads a delayed embedded question, asks automatically, selects an observed next control, and completes", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (request.url === "/question")
      return void response.end(
        `<p>Loading…</p><script>setTimeout(()=>document.body.innerHTML=\`<fieldset><legend>What is two plus two?</legend><label><input type="radio" name="q" value="four">4</label><label><input type="radio" name="q" value="five">5</label></fieldset><button onclick="location.href='/done'">I'm ready to proceed</button>\`,700)</script>`
      );
    if (request.url === "/done")
      return void response.end("<h1 data-survey-complete>Survey complete</h1>");
    response.end('<h1>Study</h1><iframe id="survey" src="/question"></iframe>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "automatic-web-flow-"));
  const store = new SqliteStore(join(directory, "agent.sqlite"));
  const provider = {
    decide: vi.fn(async (q: ProviderQuestion) => ({
      selectedOption: q.question.includes("Which ONE") ? q.options[0]! : "4",
      confidence: 0.99,
      reason: "Supported by question and options"
    }))
  };
  const runner = new SurveyRunner(
    store,
    (config) => new PlaywrightChromiumBrowser({ allowedDomains: config.allowedDomains }),
    () => new AnswerDecisionEngine(store, provider),
    directory
  );
  try {
    await runner.start(
      settingsSchema.parse({
        startUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
        allowedDomains: ["127.0.0.1"],
        platform: "generic",
        headless: true,
        stepDelayMs: 250
      })
    );
    await runner.idle();
    expect(runner.state()).toMatchObject({ run: { status: "completed", steps: 2 } });
    expect(provider.decide).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(provider.decide.mock.calls)).not.toContain("survey-frame:");
    expect(store.stats().answers).toBe(1);
  } finally {
    await runner.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15000);
