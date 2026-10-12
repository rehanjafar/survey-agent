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

it.each(["complete", "screenout", "full", "return", "filtered", "next"])(
  "runs the Swagbucks %s flow using only local mocks",
  async (outcome) => {
    const visits: string[] = [];
    const server = createServer((request, response) => {
      const path = new URL(request.url!, "http://localhost").pathname;
      visits.push(path);
      response.setHeader("content-type", "text/html");
      if (path === "/surveys") {
        response.end(`<title>Answer surveys</title><table>
          <tr data-survey-id="slow"><td>Survey 1</td><td>${outcome === "next" ? 90 : 100} SB</td><td>${outcome === "next" ? 6 : 30} min</td><td><a href="${outcome === "next" ? "/question?second" : "/slow"}">Start survey</a></td></tr>
          <tr data-survey-id="best"><td>Survey 2</td><td>80 SB</td><td>5 min</td><td><a href="/question?visit=${visits.length}">Start survey</a></td></tr>
          </table><article>Shop for 5,000 SB in 5 min <a href="/shop">Shop now</a></article>`);
      } else if (path === "/question") {
        response.end(
          `<label for="age">How old are you?</label><input id="age" type="number"><button onclick="location.href='${outcome === "return" || (outcome === "next" && !request.url!.includes("second")) ? "/surveys" : "/result"}'">Next</button>`
        );
      } else if (path === "/result") {
        response.end(
          outcome === "screenout"
            ? "You did not qualify for this survey."
            : outcome === "full"
              ? "This survey is now full."
              : "<h1 data-survey-complete>Survey complete</h1>"
        );
      } else response.end("Unexpected destination");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing address");
    const directory = await mkdtemp(join(tmpdir(), "swagbucks-mock-"));
    const store = new SqliteStore(join(directory, "agent.sqlite"));
    const provider = {
      decide: vi.fn(async () => ({ value: "30", confidence: 1, reason: "Mock chat answer" }))
    };
    const runner = new SurveyRunner(
      store,
      (settings) =>
        new PlaywrightChromiumBrowser({ allowedDomains: settings.allowedDomains, headless: true }),
      () => new AnswerDecisionEngine(store, provider),
      directory
    );
    try {
      await runner.start(
        settingsSchema.parse({
          platform: "swagbucks",
          startUrl: `http://127.0.0.1:${address.port}/surveys`,
          allowedDomains: ["127.0.0.1"],
          surveyHostCatalog: false,
          minimumHourlyReward: outcome === "filtered" ? 2000 : 900,
          maxDurationMinutes: 10,
          headless: true,
          stepDelayMs: 250
        })
      );
      await runner.idle();
      if (outcome === "complete" || outcome === "next")
        expect(runner.state().run?.status).toBe("completed");
      else
        expect(runner.state()).toMatchObject({
          run: { status: "review" },
          reason:
            outcome === "screenout"
              ? "survey_screened_out"
              : outcome === "full"
                ? "survey_unavailable"
                : "no_matching_offers"
        });
      expect(visits.filter((path) => path === "/question")).toHaveLength(
        outcome === "filtered" ? 0 : outcome === "next" ? 2 : 1
      );
      expect(provider.decide).toHaveBeenCalledTimes(
        outcome === "filtered" ? 0 : outcome === "next" ? 2 : 1
      );
      expect(visits).not.toContain("/slow");
      expect(visits).not.toContain("/shop");
      expect(store.stats().answers).toBe(outcome === "filtered" ? 0 : outcome === "next" ? 2 : 1);
    } finally {
      await runner.stop();
      store.close();
      await rm(directory, { recursive: true, force: true });
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
  20000
);
