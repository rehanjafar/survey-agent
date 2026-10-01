import { randomBytes } from "node:crypto";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { settingsSchema } from "../config/app-settings.js";
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
  let settings = initial ?? settingsSchema.parse({});
  if (!initial) {
    try {
      settings = settingsSchema.parse(JSON.parse(await readFile(configPath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("Settings file is invalid. Correct it before starting the application.");
    }
  }
  const store = new SqliteStore(join(dataDirectory, "agent.sqlite"));
  store.recoverRuns();
  const runner = new SurveyRunner(
    store,
    (config) =>
      new PlaywrightChromiumBrowser({
        allowedDomains: config.allowedDomains,
        navigationMode: config.navigationMode,
        headless: config.headless,
        userDataDirectory: join(dataDirectory, "browser-profile")
      }),
    (config) => new AnswerDecisionEngine(store, new NoCostProvider(), config.minimumConfidence),
    dataDirectory
  );
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
        facts: store.facts(),
        runs: store.runs(),
        events: store.events(),
        stats: store.stats(),
        noCost: true,
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
        case "/api/settings": {
          const run = runner.state().run;
          if (run && ["running", "review", "paused"].includes(run.status))
            throw new Error("Stop the run before changing settings.");
          const updated = settingsSchema.parse(body);
          await writeFile(configPath + ".tmp", JSON.stringify(updated, null, 2), { mode: 0o600 });
          await rename(configPath + ".tmp", configPath);
          settings = updated;
          break;
        }
        case "/api/facts/correct": {
          const correction = z
            .object({
              key: z.string().min(1).max(80),
              value: z.string().trim().min(1).max(2000),
              kind: z.enum(["stable", "preference", "temporary"]),
              established: z.boolean(),
              expectedValue: z.string(),
              confirmed: z.literal(true)
            })
            .strict()
            .parse(body);
          if (runner.state().busy) throw new Error("Pause the run before correcting facts.");
          store.correctFact(correction, correction.expectedValue);
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
        case "/api/facts": {
          const fact = z
            .object({
              key: z.string().regex(/^[a-z][a-z0-9_ .-]{0,79}$/),
              value: z.string().trim().min(1).max(2000),
              kind: z.enum(["stable", "preference", "temporary"]),
              established: z.boolean()
            })
            .strict()
            .parse(body);
          if (runner.state().busy) throw new Error("Pause the run before changing profile facts.");
          if (store.upsertFact(fact) === "conflict")
            throw new Error(
              "This conflicts with an established fact. The existing fact has been preserved."
            );
          break;
        }
        case "/api/start":
          await runner.start(settings);
          break;
        case "/api/demo":
          await runner.start({
            ...settings,
            startUrl: origin + "/mock/eureka",
            platform: "eureka",
            allowedDomains: ["127.0.0.1"],
            headless: true
          });
          break;
        case "/api/pause":
          runner.pause();
          break;
        case "/api/stop":
          await runner.stop();
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
      if (settings.restartLastRun && store.runs()[0]?.status === "interrupted")
        await runner.start(settings);
      return origin;
    },
    async close() {
      await runner.stop();
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
