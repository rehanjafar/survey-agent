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

it("selects offers, asks the provider, submits, recovers after a human-cleared CAPTCHA and continues through terminal outcomes", async () => {
  let humanClearedCaptcha = false;
  const visits: string[] = [];
  const server = createServer((request, response) => {
    const path = new URL(request.url!, "http://localhost").pathname;
    response.setHeader("content-type", "text/html; charset=utf-8");
    if (path === "/verification-status") return void response.end(String(humanClearedCaptcha));
    visits.push(path);
    if (path === "/surveys")
      return void response.end(
        [1, 2, 3]
          .map(
            (n) =>
              `<article data-survey-id="s${n}">${100 - n * 10} SB • 5 estimated minutes <a href="/question${n}">Explore survey ${n}</a></article>`
          )
          .join("") +
          (visits.includes("/result2") ? "<p>You did not qualify for this survey.</p>" : "")
      );
    const n = Number(path.at(-1));
    if (path.startsWith("/question") || path === "/actual1") {
      const question = `<label for="answer">What is two plus two?</label><input id="answer" type="number"><button onclick="if(document.querySelector('#answer').value==='4')location.href='/result${n}'">Send final response</button>`;
      if (n === 1 && !humanClearedCaptcha)
        return void response.end(
          `<p>Verify you are human</p><script>setInterval(async()=>{if(await(await fetch('/verification-status')).text()==='true')location.reload()},200)</script>`
        );
      if (path === "/question1")
        return void response.end(
          `<h1>Privacy and participation consent</h1><label><input type="checkbox" onchange="document.querySelector('button').disabled=!this.checked">I agree to the privacy policy and consent to participate</label><button disabled onclick="location.href='/actual1'">Accept and continue</button>`
        );
      return void response.end(question);
    }
    if (path === "/result1")
      return void response.end("<h1 data-survey-complete>Survey complete</h1>");
    if (path === "/result2") return void response.end("You did not qualify for this survey.");
    if (path === "/result3") return void response.end("This survey is now full.");
    response.end("Unexpected page");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing address");
  const directory = await mkdtemp(join(tmpdir(), "swagbucks-continuous-"));
  const store = new SqliteStore(join(directory, "agent.sqlite"));
  const notify = vi.fn(async () => undefined);
  const provider = {
    decide: vi.fn(async (question: ProviderQuestion) => {
      if (question.question.startsWith("The user explicitly authorizes")) {
        const selectedOption = question.options.find((option) =>
          /I agree to the privacy|Accept and continue/.test(option)
        );
        return selectedOption
          ? { selectedOption, value: "consent", confidence: 1, reason: "Authorized consent" }
          : { confidence: 0, reason: "No consent control" };
      }
      if (question.question.startsWith("Choose the best available")) {
        const selected = question.options[0]!;
        return {
          selectedOption: selected,
          value: JSON.stringify({
            reward: Number(selected.match(/(\d+) SB/)![1]),
            minutes: 5,
            unit: "SB"
          }),
          confidence: 1,
          reason: "Mock visible offer"
        };
      }
      if (question.question.includes("Which ONE"))
        return {
          selectedOption: question.options[0]!,
          value: "submit",
          confidence: 1,
          reason: "Mock final control"
        };
      return { value: "4", confidence: 1, reason: "Arithmetic" };
    })
  };
  const runner = new SurveyRunner(
    store,
    (settings) =>
      new PlaywrightChromiumBrowser({ allowedDomains: settings.allowedDomains, headless: true }),
    () => new AnswerDecisionEngine(store, provider),
    directory,
    notify
  );
  try {
    await runner.start(
      settingsSchema.parse({
        platform: "swagbucks",
        startUrl: `http://127.0.0.1:${address.port}/surveys`,
        allowedDomains: ["127.0.0.1"],
        surveyHostCatalog: false,
        provider: "chatgpt_browser",
        continuousSurveys: true,
        autoSubmit: true,
        autoAcceptConsent: true,
        offerPollSeconds: 15,
        stepDelayMs: 250,
        maxSteps: 6
      })
    );
    await expect.poll(() => notify.mock.calls.length, { timeout: 15000 }).toBe(1);
    expect(runner.state().reason).toBe("captcha_detected");
    expect(
      provider.decide.mock.calls.filter(([q]) => q.question === "What is two plus two?")
    ).toHaveLength(0);
    humanClearedCaptcha = true; // Simulates the operator solving verification, never the agent.
    await expect.poll(() => visits.includes("/result3"), { timeout: 25000 }).toBe(true);
    await expect
      .poll(() => runner.state().run?.message, { timeout: 10000 })
      .toContain("Waiting for new eligible surveys");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(
      provider.decide.mock.calls.filter(([q]) => q.question === "What is two plus two?")
    ).toHaveLength(3);
    expect(visits.filter((path) => path === "/result1")).toHaveLength(1);
    expect(visits.filter((path) => path === "/result2")).toHaveLength(1);
    expect(visits.filter((path) => path === "/result3")).toHaveLength(1);
    expect(runner.state().run?.steps).toBe(11); // Limit resets per survey, cumulative count remains visible.
    runner.pause();
    await runner.idle();
    expect(runner.state().run?.status).toBe("paused");
  } finally {
    await runner.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 45000);
