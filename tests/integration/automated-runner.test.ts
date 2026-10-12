import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
import { EurekaSurveyPlatformAdapter } from "../../src/platforms/eureka/index.js";
import { runSurveys } from "../../src/orchestration/survey-runner.js";
import { AnswerDecisionEngine } from "../../src/decision/answer-engine.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
let baseUrl: string;
let submissions = 0;
const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url === "/offers") res.end('<a href="/q1">Local survey — $1.00</a>');
  else if (req.url === "/q1" || req.url === "/q2") {
    const first = req.url === "/q1";
    res.end(
      `<fieldset><legend>${first ? "Which color?" : "Which size?"}</legend><label><input id="answer" name="choice" type="radio" required value="${first ? "Blue" : "Large"}">${first ? "Blue" : "Large"}</label></fieldset><button onclick="if(document.querySelector('#answer').checked) location.href='${first ? "/q2" : "/complete"}'">Next</button>`
    );
  } else if (req.url === "/complete") {
    submissions++;
    res.end("Survey completed");
  } else res.writeHead(404).end();
});
beforeAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("completes multiple local surveys without routine operator prompts", async () => {
  const browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
  const store = new SqliteStore(":memory:");
  try {
    const session = await browser.createSession();
    await session.navigate(`${baseUrl}/offers`);
    const adapter = new EurekaSurveyPlatformAdapter(session, {
      startUrl: `${baseUrl}/offers`,
      allowedHosts: ["127.0.0.1"],
      auditLogger: { record: async () => undefined }
    });
    const engine = new AnswerDecisionEngine(store, {
      decide: async (question) => ({
        selectedOption: question.options[0]!,
        confidence: 0.99,
        reason: "Local fixture fact"
      })
    });
    const alerts: string[] = [];
    const result = await runSurveys({
      session,
      engine,
      allowedDomains: new Set(["127.0.0.1"]),
      startUrl: `${baseUrl}/offers`,
      openOffer: () => adapter.openHighestRewardOffer(),
      notifier: {
        notify: async ({ reason }) => {
          alerts.push(reason);
        }
      },
      maxSurveys: 2,
      maxSteps: 5,
      reviewTimeoutMs: 1000,
      wait: async () => undefined
    });
    expect(result).toEqual({ status: "finished", reason: "survey_limit_reached", surveys: 2 });
    expect(submissions).toBe(2);
    expect(alerts).toEqual([]);
    expect(session.currentUrl()).toBe(`${baseUrl}/offers`);
    await session.close();
  } finally {
    store.close();
    await browser.close();
  }
});
