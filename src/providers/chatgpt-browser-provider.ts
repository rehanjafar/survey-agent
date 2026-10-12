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
  private statusText = "Not opened";
  public constructor(
    private readonly directory: string,
    private readonly launchContext: (profile: string) => Promise<BrowserContext> = (profile) =>
      chromium.launchPersistentContext(profile, { headless: false, acceptDownloads: false })
  ) {}
  public status() {
    return { status: this.statusText, open: !!this.page && !this.page.isClosed(), busy: this.busy };
  }
  public async open(): Promise<void> {
    if (!this.context) {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      this.context = await this.launchContext(join(this.directory, "chatgpt-browser-profile"));
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
      const input = page.locator(composer).filter({ visible: true });
      const draft = await input.evaluate((element) =>
        element instanceof HTMLTextAreaElement ? element.value : element.textContent
      );
      if (draft?.trim())
        throw new ProviderError(
          "The ordinary ChatGPT composer has an unsent draft. Clear or send it manually, then Resume."
        );
      const before = await page.locator(assistant).count();
      const requestId = randomUUID();
      const prompt = browserChatPrompt(question, requestId);
      if (prompt.length > 50000)
        throw new ProviderError("The question is too large for the ordinary-chat connection.");
      await input.fill(prompt);
      await this.ready();
      const send = page.getByRole("button", { name: /^send message$|^send prompt$/i });
      if ((await send.count()) !== 1 || !(await send.isEnabled()))
        throw new ProviderError(
          "ChatGPT is not ready to send. Review its browser window, then Resume."
        );
      this.statusText = "Waiting for an answer in ordinary ChatGPT…";
      await send.click(); // Never automatically retry a dispatched send.
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(500);
        await this.ready();
        const replies = page.locator(assistant);
        if ((await replies.count()) <= before) continue;
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
        const answer = parseBrowserChatReply(await content.innerText(), requestId);
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
        "Ordinary ChatGPT did not finish within 90 seconds. Inspect its usage limit or connection; the message was not resent."
      );
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
  public async close() {
    await this.context?.close();
    this.context = undefined;
    this.page = undefined;
  }
}
