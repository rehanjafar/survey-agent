import { PhoneAnswerServer } from "./phone-answer-server.js";
import { phoneAnswerOrigin } from "../notifications/phone-setup.js";
import { chromeProfile, openChromeLogin } from "../browser/chrome-login.js";
import { ChatGPTBrowserProvider } from "../providers/chatgpt-browser-provider.js";
import { ProviderError } from "../providers/provider-error.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ChatGPTAuth } from "../auth/chatgpt-auth.js";
import { ChatGPTPlanProvider } from "../providers/chatgpt-plan-provider.js";
import { NtfyNotifier } from "../notifications/ntfy-notifier.js";
import { ensurePhoneSetup, readPhoneSetup, savePhoneSetup } from "../notifications/phone-setup.js";
import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { settingsSchema, swagbucksSettings } from "../config/app-settings.js";
import type { AppSettings } from "../config/app-settings.js";
import { PlaywrightChromiumBrowser } from "../browser/index.js";
import { AnswerDecisionEngine } from "../decision/answer-engine.js";
import { NoCostProvider } from "../providers/no-cost-provider.js";
import type { ProviderDecision } from "../providers/types.js";
import { SqliteStore } from "../storage/sqlite-store.js";
import { SurveyRunner } from "../runtime/survey-runner.js";
import { mockSurvey } from "../mock/survey.js";

export async function createApplication(dataDirectory: string, initial?: AppSettings) {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const configPath = join(dataDirectory, "settings.json");
  let settings = initial ?? swagbucksSettings();
  if (!initial) {
    try {
      const saved = JSON.parse(await readFile(configPath, "utf8"));
      settings = swagbucksSettings(saved);
      if (!saved.swagbucksSetupVersion) {
        await writeFile(configPath + ".tmp", JSON.stringify(settings, null, 2), { mode: 0o600 });
        await rename(configPath + ".tmp", configPath);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Settings file is invalid. Correct it before starting the application.");
    }
  }
  const store = new SqliteStore(join(dataDirectory, "agent.sqlite"));
  store.recoverRuns();
  const regularChat = new ChatGPTBrowserProvider(dataDirectory, undefined, () => settings.browser);
  const auth = new ChatGPTAuth(dataDirectory);
  let authStatus = (await auth.credentials())
    ? "Saved ChatGPT connection — use Test ChatGPT to verify"
    : "Not connected";
  let models: readonly string[] = [];
  let signingIn: Promise<void> | undefined;
  let signInUrl: string | undefined;
  const plan = (model = "") => new ChatGPTPlanProvider(() => auth.accessToken(), model);
  const runner = new SurveyRunner(
    store,
    (config) =>
      new PlaywrightChromiumBrowser({
        allowedDomains: [...config.allowedDomains, ...config.authDomains],
        navigationMode: config.navigationMode,
        headless: config.headless,
        ...(config.browser === "chrome" ? { channel: "chrome" as const } : {}),
        userDataDirectory:
          config.browser === "chrome" && config.platform === "swagbucks"
            ? chromeProfile(dataDirectory, "swagbucks")
            : config.platform === "eureka" || config.platform === "generic"
              ? join(dataDirectory, "browser-profile")
              : join(dataDirectory, "profiles", config.platform)
      }),
    (config) =>
      new AnswerDecisionEngine(
        store,
        config.provider === "chatgpt_browser"
          ? regularChat
          : config.provider === "chatgpt_plan"
            ? plan(config.chatgptModel)
            : new NoCostProvider(),
        config.minimumConfidence,
        config.regularChatFallback && config.provider !== "chatgpt_browser"
          ? regularChat
          : undefined,
        config.platform === "swagbucks" && config.autonomousRecovery
      ),
    dataDirectory,
    async (event) => {
      const phone = await readPhoneSetup(dataDirectory);
      if (!phone?.confirmed) return false;
      const answerUrl = phoneAnswers.answerLink();
      await new NtfyNotifier(phone.topicUrl).notify({
        ...event,
        ...(answerUrl ? { answerUrl } : {})
      });
    }
  );
  const phoneAnswers = new PhoneAnswerServer(runner);
  let phoneAnswerError = "";
  const token = randomBytes(32).toString("hex");
  let origin = "";
  let mutating = false;
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent)
        json(response, 500, {
          error: "Operation failed. Check local configuration and try again."
        });
      else response.end();
    });
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  async function handle(request: IncomingMessage, response: ServerResponse) {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    if (request.headers.host !== new URL(origin).host) {
      json(response, 403, { error: "Invalid host." });
      return;
    }
    if (request.headers.origin && request.headers.origin !== origin) {
      json(response, 403, { error: "Cross-origin request blocked." });
      return;
    }
    if (request.headers["sec-fetch-site"] === "cross-site") {
      json(response, 403, { error: "Cross-site request blocked." });
      return;
    }
    const pathname = new URL(request.url ?? "/", origin).pathname;
    if (request.method === "GET" && pathname === "/") {
      const html = (
        await readFile(new URL("../../public/index.html", import.meta.url), "utf8")
      ).replace("__TOKEN__", token);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method === "GET" && ["/app.js", "/style.css"].includes(pathname)) {
      response.writeHead(200, {
        "content-type": pathname.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : "text/css; charset=utf-8"
      });
      response.end(await readFile(new URL("../../public" + pathname, import.meta.url)));
      return;
    }
    if (request.method === "GET" && pathname.startsWith("/mock/")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(mockSurvey(pathname));
      return;
    }
    if (request.headers["x-survey-token"] !== token) {
      json(response, 403, { error: "Refresh the dashboard to reconnect." });
      return;
    }
    if (request.method === "GET" && pathname === "/api/state") {
      json(response, 200, {
        settings,
        ...runner.state(),
        runs: store.runs(),
        events: store.events(),
        stats: store.stats(),
        noCost: settings.provider === "manual" && !settings.regularChatFallback,
        regularChat: regularChat.status(),
        chatgpt: { status: authStatus, models, signingIn: Boolean(signingIn), signInUrl },
        phone: (await readPhoneSetup(dataDirectory)) ?? null,
        phoneAnswers: { ...phoneAnswers.status(), error: phoneAnswerError },
        dataDirectory,
        mockUrl: origin + "/mock/eureka"
      });
      return;
    }
    if (request.method !== "POST") {
      json(response, 404, { error: "Not found." });
      return;
    }
    if (mutating) {
      json(response, 409, { error: "Another operation is in progress." });
      return;
    }
    mutating = true;
    try {
      const body = await readJson(request);
      switch (pathname) {
        case "/api/chatgpt/browser/open":
          await regularChat.open();
          break;
        case "/api/chatgpt/login": {
          if (signingIn) throw new Error("Sign-in is already open in your browser.");
          authStatus = "Waiting for browser sign-in";
          signingIn = auth
            .signIn(async (url) => {
              signInUrl = url;
              const command =
                process.platform === "darwin"
                  ? "open"
                  : process.platform === "win32"
                    ? "rundll32.exe"
                    : "xdg-open";
              await promisify(execFile)(
                command,
                process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url]
              ).catch(() => undefined);
            })
            .then(async () => {
              models = await plan().models();
              authStatus = "Connected";
            })
            .catch(() => {
              authStatus = "Sign-in failed or expired. Try again.";
            })
            .finally(() => {
              signingIn = undefined;
              signInUrl = undefined;
            });
          break;
        }
        case "/api/chatgpt/models":
          models = await plan().models();
          authStatus = "Connected";
          break;
        case "/api/chatgpt/test": {
          const input = z
            .object({ model: z.string().trim().min(1).max(200) })
            .strict()
            .parse(body);
          authStatus = "Testing a small automatic ChatGPT request…";
          try {
            models = await plan().models();
            if (!models.includes(input.model))
              throw new ProviderError("Select an available model from Refresh available models.");
            const answer = await plan(input.model).decide({
              question: "What is 2 + 2?",
              type: "single_choice",
              options: ["4", "5"]
            });
            if (answer.selectedOption !== "4" || answer.confidence < 0.9)
              throw new ProviderError(
                "ChatGPT connected but did not return the expected structured answer. Try another available model."
              );
            authStatus =
              "Verified: ChatGPT returned an automatic answer. Save Automatic mode and your model below.";
          } catch (error) {
            authStatus =
              error instanceof ProviderError
                ? error.message
                : "ChatGPT test failed. Reconnect ChatGPT, refresh available models, and retry. No paid fallback was attempted.";
          }
          break;
        }
        case "/api/phone/setup":
          await ensurePhoneSetup(dataDirectory);
          break;
        case "/api/phone/test": {
          const phone = await ensurePhoneSetup(dataDirectory);
          await new NtfyNotifier(phone.topicUrl).notify({
            reason: "test_notification",
            host: "local-agent"
          });
          await savePhoneSetup(dataDirectory, { ...phone, tested: true });
          break;
        }
        case "/api/phone/remote/test": {
          const phone = await readPhoneSetup(dataDirectory);
          if (!phone?.confirmed) throw new Error("Confirm your ntfy alerts first.");
          await new NtfyNotifier(phone.topicUrl).notify({
            reason: "remote_desktop_test",
            host: "local-agent"
          });
          break;
        }
        case "/api/phone/answers": {
          const { url } = z
            .object({ url: z.string().max(500) })
            .strict()
            .parse(body);
          const answerUrl = phoneAnswerOrigin(url);
          const phone = await ensurePhoneSetup(dataDirectory);
          await phoneAnswers.configure(answerUrl);
          await savePhoneSetup(dataDirectory, { ...phone, answerUrl });
          phoneAnswerError = "";
          break;
        }
        case "/api/phone/answers/test": {
          const phone = await readPhoneSetup(dataDirectory);
          if (!phone?.confirmed) throw new Error("Confirm your ntfy alerts first.");
          await new NtfyNotifier(phone.topicUrl).notify({
            reason: "phone_reply_test",
            host: "local-agent",
            answerUrl: phoneAnswers.testLink()
          });
          break;
        }
        case "/api/phone/confirm": {
          z.object({ received: z.literal(true) })
            .strict()
            .parse(body);
          const phone = await readPhoneSetup(dataDirectory);
          if (!phone?.tested) throw new Error("Send a test alert and check your phone first.");
          await savePhoneSetup(dataDirectory, { ...phone, confirmed: true });
          break;
        }
        case "/api/browser/login": {
          const { target } = z
            .object({ target: z.enum(["swagbucks", "chatgpt"]) })
            .strict()
            .parse(body);
          if (
            runner.state().busy ||
            ["running", "paused", "review"].includes(runner.state().run?.status ?? "")
          )
            throw new Error("Stop the run before opening a manual login window.");
          if (regularChat.status().busy)
            throw new Error("Wait for the current ChatGPT request to finish.");
          await runner.stop();
          await regularChat.close();
          await openChromeLogin(dataDirectory, target);
          break;
        }
        case "/api/settings": {
          const run = runner.state().run;
          if (run && ["running", "review", "paused"].includes(run.status))
            throw new Error("Stop the run before changing settings.");
          const updated = settingsSchema.parse(body);
          await writeFile(configPath + ".tmp", JSON.stringify(updated, null, 2), { mode: 0o600 });
          await rename(configPath + ".tmp", configPath);
          if (settings.browser !== updated.browser) await regularChat.close();
          settings = updated;
          break;
        }
        case "/api/memory/clear": {
          z.object({ confirmed: z.literal(true) })
            .strict()
            .parse(body);
          if (runner.state().busy) throw new Error("Pause the run before clearing memory.");
          store.clearMemory();
          break;
        }
        case "/api/start":
          if (settings.provider !== "manual" || settings.regularChatFallback) {
            const phone = await readPhoneSetup(dataDirectory);
            if (!phone?.confirmed)
              throw new Error(
                "Set up phone alerts, send a test, and click I received it before automatic runs."
              );
          }
          if (
            settings.platform === "swagbucks" &&
            settings.autonomousRecovery &&
            settings.provider !== "manual" &&
            !phoneAnswers.status().ready
          )
            throw new Error(
              "Save your Tailscale phone-answer address in Connections & setup before starting. Missing answers will wait for your phone."
            );
          if (settings.provider === "chatgpt_plan") {
            if (!settings.chatgptModel || !(await plan().models()).includes(settings.chatgptModel))
              throw new Error(
                "Connect ChatGPT, choose an available model, and save settings first."
              );
          }
          await runner.start(settings);
          break;
        case "/api/demo":
          await runner.start({
            ...settings,
            startUrl: origin + "/mock/eureka",
            platform: "eureka",
            provider: "manual",
            browser: "chromium",
            autonomousRecovery: false,
            autoAcceptConsent: false,
            autoSubmit: false,
            continuousSurveys: false,
            regularChatFallback: false,
            allowedDomains: ["127.0.0.1"],
            headless: true
          });
          break;
        case "/api/pause":
          runner.pause();
          break;
        case "/api/stop":
          await runner.stop();
          await regularChat.close();
          break;
        case "/api/resume": {
          const data = z
            .object({
              answer: z.unknown().optional(),
              confirmSubmit: z.boolean().optional(),
              remember: z.boolean().optional()
            })
            .strict()
            .parse(body);
          await runner.resume(
            data.answer as ProviderDecision | undefined,
            data.confirmSubmit ?? false,
            data.remember ?? false
          );
          break;
        }
        case "/api/provider/approve": {
          const data = z
            .object({ hostname: z.string().min(1).max(253), confirmed: z.literal(true) })
            .strict()
            .parse(body);
          await runner.approveProvider(data.hostname);
          break;
        }
        case "/api/browser/open": {
          const data = z
            .object({ url: z.string().url().max(8192), confirmed: z.literal(true) })
            .strict()
            .parse(body);
          await runner.openLink(data.url);
          break;
        }
        default:
          json(response, 404, { error: "Not found." });
          return;
      }
      json(response, 200, { ok: true });
    } catch (error) {
      const message =
        error instanceof z.ZodError
          ? "Invalid input. Check field values and required answer fields."
          : error instanceof Error
            ? error.message
            : "Operation failed.";
      json(response, 400, { error: message });
    } finally {
      mutating = false;
    }
  }
  return {
    server,
    store,
    runner,
    async listen(port = 4317) {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("No local server address.");
      origin = "http://127.0.0.1:" + address.port;
      const phone = await readPhoneSetup(dataDirectory);
      if (phone?.answerUrl) {
        try {
          await phoneAnswers.configure(phone.answerUrl);
        } catch {
          phoneAnswerError =
            "Phone reply service could not start on port 4318. Close any other agent instance, then save the phone address again.";
        }
      }
      if (
        settings.provider === "manual" &&
        settings.restartLastRun &&
        store.runs()[0]?.status === "interrupted"
      )
        await runner.start(settings);
      return origin;
    },
    async close() {
      await runner.stop();
      await regularChat.close();
      await phoneAnswers.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      store.close();
    }
  };
}
function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw new Error("JSON content type is required.");
  let bytes = 0;
  const parts: Buffer[] = [];
  for await (const chunk of request) {
    const part = Buffer.from(chunk);
    bytes += part.length;
    if (bytes > 65536) throw new Error("Request is too large.");
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8") || "{}");
}
