import { chromeProfile } from "../browser/chrome-login.js";
import { chromium, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { LlmProvider, ProviderDecision, ProviderQuestion } from "./types.js";
import { instructions, parseDecision } from "./decision-schema.js";
import { ProviderError } from "./provider-error.js";

const composer =
  '#mobile-composer-prompt, #prompt-textarea, textarea[aria-label="Chat with ChatGPT"]';
const assistant = '[data-message-role="assistant"], [data-message-author-role="assistant"]';
// Accept legacy records, but stop reading or writing their obsolete profile hash.
const recordSchema = z.object({ url: z.string() });
export function regularChatUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://chatgpt.com" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\/c\/[a-f0-9-]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
export function browserChatPrompt(question: ProviderQuestion, requestId: string): string {
  return (
    instructions +
    "\nUse the personal context actually available in this ChatGPT conversation, including information the user has provided here. Do not claim access to unavailable memory or other chats. Return exactly one JSON object with requestId and answer (the usual answer JSON). If needed personal information is unavailable, return confidence 0.\n" +
    JSON.stringify({ requestId, activeQuestion: question })
  );
}
export function parseBrowserChatReply(text: string, requestId: string): ProviderDecision {
  const value = z
    .object({
      requestId: z.literal(requestId),
      answer: z.unknown()
    })
    .strict()
    .parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, "")));
  return parseDecision(value.answer) as ProviderDecision;
}
/** Sends through the visible ordinary ChatGPT composer, never a private endpoint or paid API. */
export class ChatGPTBrowserProvider implements LlmProvider {
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private busy = false;
  private pending: { requestId: string; before: number; payload: string; page: Page } | undefined;
  private ownedDraft: string | undefined;
  private statusText = "Not opened";
  public constructor(
    private readonly directory: string,
    private readonly launchContext?: (profile: string) => Promise<BrowserContext>,
    private readonly browserChoice: () => "chrome" | "chromium" = () => "chrome",
    private readonly responseWaitMs = 90_000
  ) {}
  public status() {
    return { status: this.statusText, open: !!this.page && !this.page.isClosed(), busy: this.busy };
  }
  public async open(): Promise<void> {
    if (!this.context) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const profile =
        this.browserChoice() === "chrome"
          ? chromeProfile(this.directory, "chatgpt")
          : join(this.directory, "chatgpt-browser-profile");
      try {
        this.context = this.launchContext
          ? await this.launchContext(profile)
          : await chromium.launchPersistentContext(profile, {
              headless: false,
              acceptDownloads: false,
              ...(this.browserChoice() === "chrome" ? { channel: "chrome" } : {})
            });
      } catch {
        throw new ProviderError(
          "Could not open the ChatGPT browser. Install Google Chrome if selected, and close the manual login window before opening ordinary ChatGPT.",
          "authentication_required",
          "chatgpt.com"
        );
      }
      this.context.on("close", () => {
        this.context = undefined;
        this.page = undefined;
        this.statusText = "Browser closed";
      });
    }
    if (!this.page || this.page.isClosed()) {
      this.page = await this.context.newPage();
      const record = await this.record();
      await this.page.goto(record?.url ?? "https://chatgpt.com/", {
        waitUntil: "domcontentloaded"
      });
    }
    await this.page.bringToFront();
    this.statusText =
      "Ordinary ChatGPT opened. Sign in manually once, then enable the fallback and save settings.";
  }
  private async record() {
    try {
      const record = recordSchema.parse(
        JSON.parse(await readFile(join(this.directory, "chatgpt-browser-chat.json"), "utf8"))
      );
      return regularChatUrl(record.url) ? record : undefined;
    } catch {
      return undefined;
    }
  }
  private async ready(): Promise<Page> {
    const page = this.page;
    if (!page || page.isClosed())
      throw new ProviderError(
        "Open ordinary ChatGPT in Connections & setup and sign in once, then Resume."
      );
    if (new URL(page.url()).origin !== "https://chatgpt.com")
      throw new ProviderError(
        "Finish the ordinary ChatGPT sign-in manually, then Resume.",
        "authentication_required",
        "chatgpt.com"
      );
    const challenge = page
      .locator(
        'iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[src*="challenges.cloudflare.com"], [data-sitekey]'
      )
      .filter({ visible: true });
    if (
      (await challenge.count()) ||
      (await page
        .getByText(/verify you are human/i)
        .isVisible()
        .catch(() => false))
    )
      throw new ProviderError(
        "Complete the CAPTCHA in the ordinary ChatGPT browser manually, then Resume.",
        "captcha_detected",
        "chatgpt.com"
      );
    if (await page.getByRole("button", { name: /^log in$|^sign in$|^sign up for free$/i }).count())
      throw new ProviderError(
        "Sign in to ordinary ChatGPT before sending survey questions.",
        "authentication_required",
        "chatgpt.com"
      );
    if ((await page.locator(composer).filter({ visible: true }).count()) !== 1)
      throw new ProviderError(
        "Ordinary ChatGPT's composer is unavailable. Open a normal ChatGPT chat, finish any prompts, then Resume."
      );
    return page;
  }
  public async decide(question: ProviderQuestion): Promise<ProviderDecision> {
    if (this.busy) throw new ProviderError("Another ordinary ChatGPT request is still running.");
    this.busy = true;
    try {
      if (!this.page || this.page.isClosed()) await this.open();
      const page = await this.ready();
      if (page.url() !== "https://chatgpt.com/" && !regularChatUrl(page.url()))
        throw new ProviderError("Open a normal ChatGPT conversation before sending questions.");
      const payload = JSON.stringify({ ...question, resolution: undefined });
      if (this.pending) {
        if (this.pending.page !== page)
          throw new ProviderError(
            "The previous ChatGPT request belongs to a closed window. Open that conversation before restarting; it will not be resent automatically."
          );
        const matches = this.pending.payload === payload;
        const previous = await this.readPending(page);
        if (matches) return previous;
      }
      const input = page.locator(composer).filter({ visible: true });
      const draft = await input.evaluate((element) =>
        element instanceof HTMLTextAreaElement ? element.value : element.textContent
      );
      if (draft?.trim() && draft !== this.ownedDraft)
        throw new ProviderError(
          "The ordinary ChatGPT composer has an unsent draft. Clear or send it manually, then Resume."
        );
      const before = await page.locator(assistant).count();
      const requestId = randomUUID();
      const prompt = browserChatPrompt(question, requestId);
      if (prompt.length > 50000)
        throw new ProviderError("The question is too large for the ordinary-chat connection.");
      this.ownedDraft = prompt;
      await input.fill(prompt);
      await this.ready();
      const send = page
        .locator(
          '[data-testid="send-button"], button[aria-label="Send message"], button[aria-label="Send prompt"]'
        )
        .filter({ visible: true });
      if ((await send.count()) !== 1 || !(await send.isEnabled()))
        throw new ProviderError(
          "ChatGPT is not ready to send. Review its browser window, then Resume."
        );
      this.statusText = "Waiting for an answer in ordinary ChatGPT…";
      this.pending = { requestId, before, payload, page };
      await send.click(); // A later check reads this same request; it never resends it.
      this.ownedDraft = undefined;
      return await this.readPending(page);
    } catch (error) {
      this.statusText =
        error instanceof ProviderError
          ? error.message
          : "Ordinary ChatGPT returned an unreadable reply or its page changed. Inspect the chat, then Resume.";
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(this.statusText);
    } finally {
      this.busy = false;
    }
  }
  private async readPending(page: Page): Promise<ProviderDecision> {
    const deadline = Date.now() + this.responseWaitMs;
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      await this.ready();
      const replies = page.locator(assistant);
      if ((await replies.count()) <= this.pending!.before) continue;
      const last = replies.last();
      const complete =
        (await last.getAttribute("data-message-complete")) !== null ||
        (await last
          .locator('[data-assistant-message-actions],button[aria-label="Copy response"]')
          .count()) > 0;
      const stopping = await page
        .getByRole("button", { name: /^stop(?: generating| response)?$/i })
        .count();
      if (!complete || stopping) continue;
      const content = last.locator("[data-assistant-markdown],.markdown").first();
      if (!(await content.count()))
        throw new ProviderError(
          "ChatGPT reply format changed. Inspect the selected chat; no answer was applied."
        );
      const text = await content.innerText();
      const requestId = this.pending!.requestId;
      this.pending = undefined;
      let answer: ProviderDecision;
      try {
        answer = parseBrowserChatReply(text, requestId);
      } catch {
        answer = {
          confidence: 0,
          reason:
            "The completed reply was not a valid answer. Re-evaluate the question in the requested format."
        };
      }
      if (regularChatUrl(page.url())) {
        const path = join(this.directory, "chatgpt-browser-chat.json");
        await writeFile(path + ".tmp", JSON.stringify({ url: page.url() }), {
          mode: 0o600
        });
        await rename(path + ".tmp", path);
      }
      this.statusText = "Ordinary ChatGPT answered automatically";
      return answer;
    }
    throw new ProviderError(
      "Ordinary ChatGPT has not finished yet. Waiting for the existing reply; the message will not be resent."
    );
  }
  public async close() {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
    this.pending = undefined;
    this.ownedDraft = undefined;
  }
}
