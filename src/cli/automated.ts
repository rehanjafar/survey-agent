import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, mkdir, writeFile, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { ChatGPTAuth } from "../auth/chatgpt-auth.js";
import { ChatGPTPlanProvider } from "../providers/chatgpt-plan-provider.js";
import { NtfyNotifier } from "../notifications/ntfy-notifier.js";
import { runSurveys } from "../orchestration/survey-runner.js";
import { resolve } from "node:path";
import { loadRuntimeConfig } from "../config/runtime-config.js";
import type { PageState } from "../browser/types.js";
import { PlaywrightChromiumBrowser } from "../browser/index.js";
import { swagbucksOutcome } from "../platforms/swagbucks/outcome.js";
import { EurekaSurveyPlatformAdapter } from "../platforms/eureka/index.js";
import { ManualChatGPTProvider } from "../providers/index.js";
import { AnswerDecisionEngine } from "../decision/answer-engine.js";
import { SqliteStore } from "../storage/sqlite-store.js";
import { extractCurrentQuestion } from "../extraction/question-extractor.js";
import { guidedSetup } from "./setup.js";
import {
  readSettings,
  settingsEnvironment,
  type GuidedSettings
} from "../config/guided-settings.js";
import { PanelSurveyAdapter } from "../platforms/panels/panel-adapter.js";
import { platformPresets } from "../platforms/panels/presets.js";
import { executeAction } from "../execution/action-executor.js";

let config = loadRuntimeConfig();
let [command, startUrl] = process.argv.slice(2);
let guided: GuidedSettings | undefined;
async function openSignIn(url: string): Promise<void> {
  const executable =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
  await promisify(execFile)(
    executable,
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url]
  );
}
if (command === "start" || command === "setup") {
  if (!process.stdin.isTTY)
    throw new Error("Open a terminal and run corepack pnpm guided for the guided menu.");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const directory = resolve(config.dataDirectory);
  const setupAuth = new ChatGPTAuth(directory, config.chatgptAccount);
  const setup = async (): Promise<GuidedSettings> =>
    guidedSetup(
      directory,
      {
        question: (prompt) => terminal.question(prompt),
        print: (message) => console.log(message),
        models: () => new ChatGPTPlanProvider(() => setupAuth.accessToken(), "").models(),
        signIn: () => setupAuth.signIn(openSignIn).then(() => undefined),
        testNotification: (topic) =>
          new NtfyNotifier(topic, config.ntfyToken).notify({
            reason: "test_notification",
            host: "local-agent"
          })
      },
      guided,
      config.ntfyTopicUrl
    );
  try {
    // setup can repair a malformed saved file without requiring the user to edit JSON.
    if (command === "start") guided = await readSettings(directory);
    else {
      try {
        guided = await readSettings(directory);
      } catch {
        /* Replace invalid setup. */
      }
    }
    if (!guided || command === "setup") guided = await setup();
    if (command === "setup") command = "done";
    else {
      for (;;) {
        console.log(
          `\n${platformPresets[guided.platform].name}: saved login, ChatGPT plan, phone alerts.\n1. Log in / fix the saved session\n2. Run authorized surveys\n3. Change platform or settings\n4. Exit`
        );
        const choice = (await terminal.question("Choose [2]: ")).trim() || "2";
        if (choice === "3") {
          guided = await setup();
          continue;
        }
        if (choice === "4") {
          command = "done";
          break;
        }
        if (choice === "1" || choice === "2") {
          command = choice === "1" ? "login" : "run";
          break;
        }
      }
    }
    config = loadRuntimeConfig({ ...process.env, ...settingsEnvironment(guided, directory) });
    startUrl = guided.startUrl;
  } finally {
    terminal.close();
  }
}
const auth = new ChatGPTAuth(resolve(config.dataDirectory), config.chatgptAccount);
const notificationFile = resolve(config.dataDirectory, "notification.json");
async function notifier(): Promise<NtfyNotifier> {
  let topicUrl = config.ntfyTopicUrl;
  if (!topicUrl) {
    try {
      topicUrl = z
        .object({ topicUrl: z.string() })
        .parse(JSON.parse(await readFile(notificationFile, "utf8"))).topicUrl;
    } catch {
      throw new Error("Run notify-setup and subscribe on your phone before automated runs.");
    }
  }
  return new NtfyNotifier(topicUrl, config.ntfyToken);
}
if (command === "done") {
  console.log("Run corepack pnpm guided whenever you are ready.");
} else if (command === "chatgpt-login") {
  console.log(
    "Continue with ChatGPT: authorize Survey Agent to use your ChatGPT plan. No paid API key is used."
  );
  await auth.signIn(openSignIn);
  console.log(
    `ChatGPT account '${config.chatgptAccount}' connected. Manage usage in ChatGPT Settings > Usage.`
  );
} else if (command === "chatgpt-models") {
  const provider = new ChatGPTPlanProvider(() => auth.accessToken(), "");
  console.log((await provider.models()).join("\n"));
} else if (command === "notify-setup") {
  await mkdir(resolve(config.dataDirectory), { recursive: true, mode: 0o700 });
  const topicUrl = `https://ntfy.sh/survey-agent-${randomBytes(16).toString("hex")}`;
  try {
    await writeFile(notificationFile, JSON.stringify({ topicUrl }), { mode: 0o600, flag: "wx" });
    console.log(`Subscribe to this topic in the ntfy phone app: ${topicUrl}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    console.log(
      `Subscribe to the existing topic in the ntfy phone app: ${z.object({ topicUrl: z.string() }).parse(JSON.parse(await readFile(notificationFile, "utf8"))).topicUrl}`
    );
  }
} else if (command === "notify-test") {
  await (await notifier()).notify({ reason: "test_notification", host: "local-agent" });
  console.log("Test notification sent. Check your phone.");
} else if (!command) {
  console.log(
    "Run corepack pnpm guided for guided setup, login, and automated runs. Advanced commands are documented in docs/advanced.md."
  );
} else {
  if (!["login", "eureka", "run"].includes(command ?? "") || !startUrl)
    throw new Error("Usage: dev [login|eureka|run] <authorized start URL>");
  if (command !== "run" && !process.stdin.isTTY)
    throw new Error("Interactive login/chat review requires a terminal.");
  if (command === "eureka" && config.llmProvider !== "manual_chatgpt")
    throw new Error(
      "The interactive Eureka command requires manual_chatgpt (zero paid API calls)."
    );
  if (command === "run" && (config.llmProvider !== "chatgpt_plan" || !config.chatgptModel))
    throw new Error("Automated runs require chatgpt_plan and a model from chatgpt-models.");
  const phoneNotifier = command === "run" ? await notifier() : undefined;
  const planProvider =
    command === "run"
      ? new ChatGPTPlanProvider(() => auth.accessToken(), config.chatgptModel!)
      : undefined;
  if (planProvider && !(await planProvider.models()).includes(config.chatgptModel!))
    throw new Error("Selected model is unavailable for this ChatGPT account.");
  await mkdir(resolve(config.dataDirectory), { recursive: true });
  const lockPath = resolve(config.dataDirectory, "runner.lock");
  await writeFile(lockPath, String(process.pid), { flag: "wx", mode: 0o600 });
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
  const controller = new AbortController();
  const interrupt = (): void => controller.abort();
  if (command === "run") process.on("SIGINT", interrupt);
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
      console.log("Login saved. Run corepack pnpm guided and choose Run authorized surveys.");
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
      if (command === "run" && phoneNotifier && planProvider) {
        console.log(
          "Using ChatGPT plan. Manage app limits/credits in ChatGPT Settings > Usage. No paid API fallback."
        );
        store = new SqliteStore(resolve(config.dataDirectory, "answers.sqlite"));
        const result = await runSurveys({
          session,
          engine: new AnswerDecisionEngine(store, planProvider),
          allowedDomains: new Set([...config.allowedDomains, ...config.surveyDomains]),
          authenticationDomains: new Set(config.authDomains),
          notifier: phoneNotifier,
          openOffer:
            guided && guided.platform !== "eureka"
              ? (() => {
                  const panel = new PanelSurveyAdapter(session, {
                    platform: guided.platform,
                    startUrl,
                    allowedHosts: [...config.allowedDomains, ...config.surveyDomains],
                    currency: guided.currency,
                    minimumHourlyReward: guided.minimumHourlyReward,
                    maxDurationMinutes: guided.maxDurationMinutes
                  });
                  return () => panel.openBestOffer();
                })()
              : () => adapter.openHighestRewardOffer(),
          startUrl,
          maxSurveys: config.maxSurveys,
          maxSteps: config.maxSteps,
          reviewTimeoutMs: config.reviewTimeoutMs,
          ...(guided && guided.platform !== "eureka"
            ? {
                surveyPageAllowed: (state: PageState) =>
                  new URL(state.url).origin !== new URL(startUrl).origin
              }
            : {}),
          ...(guided?.platform === "swagbucks" ? { surveyStopReason: swagbucksOutcome } : {}),
          signal: controller.signal
        });
        console.log(JSON.stringify(result));
        const blockedHost = session.blockedNavigationHost?.();
        if (blockedHost)
          console.log(
            `Blocked destination: ${blockedHost}. In Change settings, add this host only if authorized: login-only hosts for sign-in, external study hosts for surveys. Then restart the run.`
          );
        if (result.status === "review" && !controller.signal.aborted) {
          if (process.stdin.isTTY)
            await terminal.question(
              "Agent stopped for review; browser remains open. Press Enter to disconnect. "
            );
          else await new Promise<void>((resolve) => process.once("SIGINT", resolve));
        }
      } else {
        const opened = await adapter.openHighestRewardOffer();
        if (opened.status === "review") console.log(JSON.stringify(opened));
        else {
          store = new SqliteStore(resolve(config.dataDirectory, "answers.sqlite"));
          const provider = new ManualChatGPTProvider(async (prompt) => {
            console.log(
              `\nReview the following question before sharing them in a normal ChatGPT chat:\n${prompt}\n`
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
                (await terminal.question(
                  "Apply this answer to the current question? Type yes: "
                )) === "yes"
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
    }
    await session.close();
  } finally {
    if (command === "run") process.off("SIGINT", interrupt);
    store?.close();
    terminal.close();
    await browser.close();
    await unlink(lockPath);
  }
}
