import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import { PlaywrightChromiumBrowser } from "../browser/index.js";
import { EurekaSurveyPlatformAdapter } from "../platforms/eureka/index.js";
import { ManualChatGPTProvider } from "../providers/index.js";
import { AnswerDecisionEngine } from "../decision/answer-engine.js";
import { SqliteStore } from "../storage/sqlite-store.js";
import { extractCurrentQuestion } from "../extraction/question-extractor.js";
import { executeAction } from "../execution/action-executor.js";

const config = loadRuntimeConfig();
const [command, startUrl] = process.argv.slice(2);
if (!command) {
  console.log(
    JSON.stringify({
      status: "ready",
      version: "0.1.0",
      llmProvider: config.llmProvider,
      allowedDomains: config.allowedDomains
    })
  );
} else {
  if (!["login", "eureka"].includes(command ?? "") || !startUrl)
    throw new Error("Usage: dev [login|eureka] <authorized start URL>");
  if (!process.stdin.isTTY) throw new Error("Interactive login/chat review requires a terminal.");
  if (command === "eureka" && config.llmProvider !== "manual_chatgpt")
    throw new Error(
      "The interactive Eureka command requires manual_chatgpt (zero paid API calls)."
    );
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const browser = new PlaywrightChromiumBrowser({
    allowedDomains: [...config.allowedDomains, ...config.authDomains, ...config.surveyDomains],
    mode: config.browserMode,
    ...(config.cdpEndpoint ? { cdpEndpoint: config.cdpEndpoint } : {}),
    ...(config.browserMode === "managed_chromium"
      ? {
          userDataDirectory: resolve(
            config.profileDirectory || `${config.dataDirectory}/chrome-profile`
          ),
          channel: "chrome" as const
        }
      : {}),
    headless: false
  });
  let store: SqliteStore | undefined;
  try {
    const session = await browser.createSession(
      config.browserMode === "attached_chrome" ? { existingPageUrl: startUrl } : {}
    );
    if (config.browserMode === "managed_chromium") await session.navigate(startUrl);
    if (command === "login") {
      await terminal.question(
        "Log in manually in Chrome, including any verification. Press Enter to save the session and disconnect. "
      );
      console.log("Session retained. Run eureka with the same profile and start URL.");
    } else {
      const adapter = new EurekaSurveyPlatformAdapter(session, {
        startUrl,
        allowedHosts: [...config.allowedDomains, ...config.surveyDomains],
        auditLogger: {
          record: async (event) => {
            console.log(JSON.stringify(event));
          }
        }
      });
      const opened = await adapter.openHighestRewardOffer();
      if (opened.status === "review") console.log(JSON.stringify(opened));
      else {
        store = new SqliteStore(resolve(config.dataDirectory, "answers.sqlite"));
        const provider = new ManualChatGPTProvider(async (prompt) => {
          console.log(
            `\nReview the following question/facts before sharing them in a normal ChatGPT chat:\n${prompt}\n`
          );
          return terminal.question("Paste the single-line JSON reply (or Enter to stop): ");
        });
        const engine = new AnswerDecisionEngine(store, provider);
        const state = await session.capturePageState();
        const question = extractCurrentQuestion(state);
        if (!question) console.log("Human review required: no supported question found.");
        else {
          const result = await engine.decide(question);
          if (result.status === "review") console.log(JSON.stringify(result));
          else {
            // Recheck the page after the human handoff so stale selectors never execute.
            const current = await session.capturePageState();
            const latest = extractCurrentQuestion(current);
            if (
              current.url !== state.url ||
              current.title !== state.title ||
              current.text !== state.text ||
              JSON.stringify(latest) !== JSON.stringify(question)
            )
              throw new Error("Page changed during review; no action executed.");
            if (
              (await terminal.question("Apply this answer to the current question? Type yes: ")) ===
              "yes"
            ) {
              await executeAction(session, result.action);
              await terminal.question(
                "Answer applied. Review the page manually; press Enter to disconnect. "
              );
            }
          }
        }
      }
    }
    await session.close();
  } finally {
    store?.close();
    terminal.close();
    await browser.close();
  }
}
