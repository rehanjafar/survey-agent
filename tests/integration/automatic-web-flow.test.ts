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
      ...(q.question.includes("Which ONE") ? { value: "continue" } : {}),
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

it("finds a survey hub, selects an offer and opens study details on an unnamed platform", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    const pages: Record<string, string> = {
      "/": "<h1>Welcome</h1><a href='/surveys'>Available surveys</a><a href='/redeem'>Redeem rewards</a>",
      "/surveys":
        "<article>$1 · 30 min <a href='/slow'>Start survey</a></article><article>$2 · 5 min <a href='/details'>View study</a></article>",
      "/details": "<h1>Study details</h1><a href='/question'>Begin study</a>",
      "/question":
        "<label for='age'>How old are you?</label><input id='age' type='number'><button onclick=\"location.href='/done'\">Next page</button>",
      "/done": "<h1 data-survey-complete>Survey complete</h1>"
    };
    response.end(pages[request.url!] || "Wrong destination");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "generic-discovery-"));
  const store = new SqliteStore(join(directory, "agent.sqlite"));
  const provider = {
    decide: vi.fn(async () => ({ value: "30", confidence: 1, reason: "Mock chat context" }))
  };
  const runner = new SurveyRunner(
    store,
    (settings) => new PlaywrightChromiumBrowser({ allowedDomains: settings.allowedDomains }),
    () => new AnswerDecisionEngine(store, provider),
    directory
  );
  try {
    await runner.start(
      settingsSchema.parse({
        platform: "generic",
        startUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
        allowedDomains: ["127.0.0.1"],
        headless: true,
        stepDelayMs: 250
      })
    );
    await runner.idle();
    expect(runner.state()).toMatchObject({ run: { status: "completed", steps: 5 } });
    expect(provider.decide).toHaveBeenCalledOnce();
  } finally {
    await runner.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15000);

it("reuses earlier answers within one survey and resets this memory for a new run", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/done")
      return void response.end("<h1 data-survey-complete>Survey complete</h1>");
    const next = request.url === "/" ? "/repeat" : "/done";
    response.end(
      `<fieldset><legend>Which option matches the example?</legend><label><input name="q" type="radio" value="A">A</label><label><input name="q" type="radio" value="B">B</label></fieldset><button onclick="location.href='${next}'">Next</button>`
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const directory = await mkdtemp(join(tmpdir(), "survey-memory-"));
  const store = new SqliteStore(join(directory, "agent.sqlite"));
  const provider = {
    decide: vi.fn(async () => ({
      selectedOption: "A",
      confidence: 0.99,
      reason: "Objective example"
    }))
  };
  const runner = new SurveyRunner(
    store,
    (settings) => new PlaywrightChromiumBrowser({ allowedDomains: settings.allowedDomains }),
    () => new AnswerDecisionEngine(store, provider),
    directory
  );
  const settings = settingsSchema.parse({
    platform: "generic",
    startUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`,
    allowedDomains: ["127.0.0.1"],
    headless: true,
    stepDelayMs: 250
  });
  try {
    await runner.start(settings);
    await runner.idle();
    expect(runner.state().run?.status).toBe("completed");
    expect(provider.decide).toHaveBeenCalledOnce();
    expect(store.events().some((event) => String(event.detail).includes("survey_memory"))).toBe(
      true
    );
    await runner.start(settings);
    await runner.idle();
    expect(runner.state().run?.status).toBe("completed");
    expect(provider.decide).toHaveBeenCalledTimes(2);
  } finally {
    await runner.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 15000);
