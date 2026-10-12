import { chromium } from "playwright";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ChatGPTBrowserProvider } from "../../src/providers/chatgpt-browser-provider.js";
it("sends through a mock ordinary chat, waits for completion, and refuses to overwrite a draft", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-chat-"));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.route("**/*", async (route) => {
    if (route.request().url() !== "https://chatgpt.com/") return route.abort();
    await route.fulfill({
      contentType: "text/html",
      body: `<textarea id="mobile-composer-prompt" aria-label="Chat with ChatGPT"></textarea><button aria-label="Send message" onclick="send()">Send</button><script>function send(){
   const p=document.querySelector('textarea');const payload=JSON.parse(p.value.trim().split('\\n').at(-1));p.value='';
   history.pushState({},'', '/c/1234-abcd');
   setTimeout(()=>{const message=document.createElement('div');message.setAttribute('data-message-role','assistant');message.setAttribute('data-message-complete','');const content=document.createElement('div');content.setAttribute('data-assistant-markdown','');content.textContent=JSON.stringify({requestId:payload.requestId,personal:true,sourceFactKeys:['vehicle'],answer:{selectedOption:'Yes',confidence:1,reason:'Confirmed'}});message.append(content);document.body.append(message);},100);
   }</script>`
    });
  });
  const provider = new ChatGPTBrowserProvider(
    directory,
    () => [{ key: "vehicle", value: "I own a car" }],
    async () => context
  );
  try {
    await provider.open();
    const page = context.pages()[0]!;
    const answer = await provider.decide({
      question: "Do you own a car?",
      type: "single_choice",
      options: ["Yes", "No"],
      relevantProfileFacts: [],
      requiresPersonalFacts: true
    });
    expect(answer.selectedOption).toBe("Yes");
    expect(provider.status().status).toContain("answered automatically");
    await page.evaluate(() => {
      const widget = document.createElement("div");
      widget.setAttribute("data-sitekey", "mock");
      widget.textContent = "CAPTCHA";
      document.body.append(widget);
    });
    await expect(
      provider.decide({ question: "Q", type: "text", options: [], relevantProfileFacts: [] })
    ).rejects.toMatchObject({ reviewReason: "captcha_detected", reviewHost: "chatgpt.com" });
    await page.locator("[data-sitekey]").evaluate((element) => element.remove());
    await page.locator("textarea").fill("My unsent draft");
    await expect(
      provider.decide({ question: "Q", type: "text", options: [], relevantProfileFacts: [] })
    ).rejects.toThrow("unsent draft");
    expect(await page.locator("textarea").inputValue()).toBe("My unsent draft");
    expect(await page.locator('[data-message-role="assistant"]').count()).toBe(1);
  } finally {
    await provider.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
