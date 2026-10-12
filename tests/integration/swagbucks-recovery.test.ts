import { chromium } from "playwright";
import { PhoneAnswerServer } from "../../src/ui/phone-answer-server.js";
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
it("waits for a phone answer, applies it on the laptop, and continues with a supported objective answer", async () => {
  const visits: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    visits.push(path);
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (path === "/surveys")
      return void response.end(
        [1, 3]
          .map(
            (n) =>
              `<article data-survey-id="${n}">${100 - n} SB 5 min <a href="/survey${n}">Start survey</a></article>`
          )
          .join("")
      );
    if (path === "/survey1")
      return void response.end(
        '<form action="/done"><fieldset><legend>What is your employment status?</legend>' +
          ["Full-time", "Part-time", "Self-employed", "Student", "Retired", "Other"]
            .map(
              (label) =>
                `<label><input type="radio" name="employment" value="${label}">${label}</label>`
            )
            .join("") +
          '</fieldset><button type="submit">Submit</button></form>'
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
  let alertLink: string | undefined;
  const notify = vi.fn(async () => {
    alertLink = phone.answerLink();
  });
  const provider = {
    decide: vi.fn(async (q: ProviderQuestion) =>
      q.question.includes("employment")
        ? { confidence: 0, reason: "No personal employment information is available" }
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
  const phone = new PhoneAnswerServer(runner);
  await phone.configure("https://laptop.test.ts.net", 0);
  const mobile = await chromium.launch();
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
    await expect.poll(() => runner.state().run?.status, { timeout: 15000 }).toBe("review");
    await runner.idle();
    expect(visits).not.toContain("/survey3");
    expect(store.stats().answers).toBe(0);
    expect(alertLink).toMatch(/^https:\/\/laptop.test.ts.net\/#/);
    const oldToken = new URL(alertLink!).hash.slice(1);
    expect(
      (
        await fetch(phone.status().localOrigin + "/answer", {
          method: "POST",
          headers: { "x-answer-token": oldToken, "content-type": "application/json" },
          body: JSON.stringify({
            selectedOption: "Not an actual option",
            confidence: 1,
            reason: "invalid"
          })
        })
      ).status
    ).toBe(400);
    expect(runner.state().run?.status).toBe("review");
    const page = await mobile.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(phone.status().localOrigin + "/#" + oldToken);
    await page.locator("#question").waitFor();
    await expect.poll(() => page.locator("#answer-form").isVisible()).toBe(true);
    expect(await page.locator("input:checked").count()).toBe(0);
    expect(await page.locator("#controls label").count()).toBe(4);
    await page.locator("summary").click();
    await page.getByLabel("Retired", { exact: true }).check();
    await page.locator("#send").click();
    await expect.poll(() => page.locator("#status").textContent()).toContain("Answer sent");
    expect(errors).toEqual([]);
    expect(
      (
        await fetch(phone.status().localOrigin + "/answer", {
          method: "POST",
          headers: { "x-answer-token": oldToken, "content-type": "application/json" },
          body: JSON.stringify({ selectedOption: "Student", confidence: 1, reason: "duplicate" })
        })
      ).status
    ).toBe(410);
    await expect
      .poll(() => runner.state().run?.message, { timeout: 20000 })
      .toContain("Waiting for new eligible surveys");
    expect(visits).toContain("/done");
    expect(
      provider.decide.mock.calls.filter(([q]) => q.question.includes("employment"))
    ).toHaveLength(2);
    expect(visits).toContain("/done");
    expect(store.stats().answers).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(runner.state().run?.status).toBe("running");
    runner.pause();
    await runner.idle();
  } finally {
    await mobile.close();
    await phone.close();
    await runner.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 35000);

it("rejects a phone answer when the laptop page has changed while waiting", async () => {
  const server = createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(
      `<fieldset><legend>${request.url === "/changed" ? "A different question" : "What is your employment status?"}</legend><label><input type="radio" name="q" value="Retired">Retired</label></fieldset><button>Next</button>`
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("address");
  const directory = await mkdtemp(join(tmpdir(), "phone-stale-page-"));
  const store = new SqliteStore(join(directory, "agent.sqlite"));
  const driver = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"], headless: true });
  let session: Awaited<ReturnType<typeof driver.createSession>>;
  const runner = new SurveyRunner(
    store,
    () => ({
      launch: () => driver.launch(),
      close: () => driver.close(),
      createSession: async () => {
        session = await driver.createSession();
        return session;
      }
    }),
    () =>
      new AnswerDecisionEngine(store, {
        decide: async () => ({ confidence: 0, reason: "Personal context missing" })
      }),
    directory
  );
  try {
    await runner.start(
      settingsSchema.parse({
        platform: "generic",
        startUrl: `http://127.0.0.1:${address.port}`,
        allowedDomains: ["127.0.0.1"],
        surveyHostCatalog: false
      })
    );
    await runner.idle();
    expect(runner.state().reason).toBe("low_confidence");
    const id = runner.state().reviewId!;
    // A different control binding appears while the human is answering.
    await session!.navigate(`http://127.0.0.1:${address.port}/changed`);
    await runner.answerFromPhone(id, {
      selectedOption: "Retired",
      confidence: 1,
      reason: "User answer"
    });
    await runner.idle();
    expect(store.stats().answers).toBe(0);
    expect(runner.state().reason).toBe("unexpected_page");
    await expect(
      runner.answerFromPhone(id, { selectedOption: "Retired", confidence: 1, reason: "stale" })
    ).rejects.toThrow("no longer ready");
  } finally {
    await runner.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
