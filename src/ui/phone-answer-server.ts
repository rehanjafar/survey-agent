import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import type { SurveyRunner } from "../runtime/survey-runner.js";
import { providerQuestion } from "../decision/answer-engine.js";
import type { ProviderDecision } from "../providers/types.js";
import { parseDecision } from "../providers/decision-schema.js";
import { phoneAnswerOrigin } from "../notifications/phone-setup.js";

const answerReasons = new Set(["low_confidence", "missing_information", "unsupported_question"]);
/** A separate, loopback-only service exposed through private Tailscale Serve. No admin routes. */
export class PhoneAnswerServer {
  private origin = "";
  private localOrigin = "";
  private ticket: { token: string; reviewId: string; used: boolean } | undefined;
  private testTicket: { token: string; expires: number } | undefined;
  private submitting = false;
  private readonly server = createServer((request, response) => {
    void this.handle(request, response).catch(() => {
      if (!response.headersSent) this.json(response, 400, { error: "Invalid answer request." });
      else response.end();
    });
  });
  public constructor(private readonly runner: Pick<SurveyRunner, "state" | "answerFromPhone">) {
    this.server.requestTimeout = 15_000;
    this.server.headersTimeout = 10_000;
  }
  public async configure(origin: string, port = 4318): Promise<void> {
    const next = phoneAnswerOrigin(origin);
    if (!this.server.listening) {
      await new Promise<void>((resolve, reject) => {
        this.server.once("error", reject);
        this.server.listen(port, "127.0.0.1", () => {
          this.server.off("error", reject);
          resolve();
        });
      });
      const address = this.server.address();
      if (!address || typeof address === "string") throw new Error("No phone service address.");
      this.localOrigin = `http://127.0.0.1:${address.port}`;
    }
    if (this.origin !== next) {
      this.ticket = undefined;
      this.testTicket = undefined;
    }
    this.origin = next;
  }
  public status() {
    return { ready: this.server.listening, origin: this.origin, localOrigin: this.localOrigin };
  }
  public answerLink(): string | undefined {
    const state = this.runner.state();
    if (
      !this.server.listening ||
      state.run?.status !== "review" ||
      !state.reviewId ||
      !state.question ||
      state.pendingNavigation ||
      !answerReasons.has(state.reason ?? "")
    )
      return undefined;
    if (this.ticket?.reviewId !== state.reviewId)
      this.ticket = {
        token: randomBytes(32).toString("hex"),
        reviewId: state.reviewId,
        used: false
      };
    return this.ticket?.used ? undefined : `${this.origin}/#${this.ticket!.token}`;
  }
  public testLink(): string {
    if (!this.server.listening) throw new Error("Save your Tailscale address first.");
    this.testTicket = { token: randomBytes(32).toString("hex"), expires: Date.now() + 600_000 };
    return `${this.origin}/#${this.testTicket.token}`;
  }
  public async close(): Promise<void> {
    this.ticket = undefined;
    this.testTicket = undefined;
    if (this.server.listening)
      await new Promise<void>((resolve) => {
        this.server.close(() => resolve());
        this.server.closeAllConnections();
      });
  }
  private json(response: ServerResponse, status: number, body: unknown) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(body));
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    if (
      !this.origin ||
      ![new URL(this.origin).host, new URL(this.localOrigin).host].includes(
        request.headers.host ?? ""
      ) ||
      (request.headers.origin && ![this.origin, this.localOrigin].includes(request.headers.origin))
    ) {
      this.json(response, 403, { error: "Invalid origin." });
      return;
    }
    const path = new URL(request.url ?? "/", this.localOrigin).pathname;
    const assets: Record<string, string> = {
      "/": "phone.html",
      "/phone.js": "phone.js",
      "/phone.css": "phone.css"
    };
    if (request.method === "GET" && assets[path]) {
      response.writeHead(200, {
        "content-type": path.endsWith(".js")
          ? "text/javascript; charset=utf-8"
          : path.endsWith(".css")
            ? "text/css; charset=utf-8"
            : "text/html; charset=utf-8"
      });
      response.end(await readFile(new URL(`../../public/${assets[path]}`, import.meta.url)));
      return;
    }
    if (!["/question", "/answer"].includes(path)) {
      this.json(response, 404, { error: "Not found." });
      return;
    }
    const token = request.headers["x-answer-token"];
    const test =
      typeof token === "string" &&
      token === this.testTicket?.token &&
      this.testTicket.expires > Date.now();
    const state = this.runner.state();
    const ticket = this.ticket;
    if (
      !test &&
      (!ticket ||
        ticket.used ||
        token !== ticket.token ||
        state.reviewId !== ticket.reviewId ||
        state.run?.status !== "review" ||
        !state.question ||
        state.pendingNavigation ||
        !answerReasons.has(state.reason ?? ""))
    ) {
      this.json(response, 410, {
        error: "This link is no longer active. Open the latest phone alert."
      });
      return;
    }
    if (request.method === "GET" && path === "/question") {
      const q = state.question;
      this.json(
        response,
        200,
        test
          ? {
              test: true,
              busy: false,
              question: {
                question: "Can you answer from your phone?",
                type: "single_choice",
                options: ["Yes, this works"]
              }
            }
          : {
              test: false,
              busy: state.busy,
              question: {
                ...providerQuestion(q!),
                required: q!.required,
                min: q!.min,
                max: q!.max,
                step: q!.step,
                maxLength: q!.maxLength
              }
            }
      );
      return;
    }
    if (request.method !== "POST" || path !== "/answer") {
      this.json(response, 405, { error: "Method not allowed." });
      return;
    }
    if (this.submitting || (!test && state.busy)) {
      this.json(response, 409, {
        error: "The laptop is finishing its check. Try again in a moment."
      });
      return;
    }
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      this.json(response, 415, { error: "JSON required." });
      return;
    }
    this.submitting = true;
    try {
      let bytes = 0;
      const parts: Buffer[] = [];
      for await (const chunk of request) {
        const part = Buffer.from(chunk);
        bytes += part.length;
        if (bytes > 32_768) throw new Error("Request too large.");
        parts.push(part);
      }
      const answer = parseDecision(JSON.parse(Buffer.concat(parts).toString("utf8")));
      if (test) {
        if (answer.selectedOption !== "Yes, this works") throw new Error("Choose the test answer.");
        this.testTicket = undefined;
      } else {
        await this.runner.answerFromPhone(ticket!.reviewId, answer as ProviderDecision);
        ticket!.used = true;
      }
      this.json(response, 202, {
        message: test
          ? "Phone replies are working. You can close this page."
          : "Answer sent. The laptop is rechecking the survey before applying it. If it needs more input, you will receive another alert."
      });
    } catch {
      this.json(response, 400, {
        error:
          "The answer could not be accepted. Check your choices and constraints, or open the latest alert if the question changed."
      });
    } finally {
      this.submitting = false;
    }
  }
}
