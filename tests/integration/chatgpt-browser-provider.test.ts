import { chromium } from "playwright";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ChatGPTBrowserProvider } from "../../src/providers/chatgpt-browser-provider.js";
it("sends through a mock ordinary chat, waits for completion, and refuses to overwrite a draft", async () => {
  const directory = await mkdtemp(join(tmpdir(), "browser-chat-"));
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await writeFile(
    join(directory, "chatgpt-browser-chat.json"),
    JSON.stringify({ url: "https://chatgpt.com/c/abcd-1234", profileHash: "legacy" })
  );
  await context.route("**/*", async (route) => {
    if (
      !["https://chatgpt.com/", "https://chatgpt.com/c/abcd-1234"].includes(route.request().url())
    )
      return route.abort();
    await route.fulfill({
      contentType: "text/html",
      body: `<textarea id="mobile-composer-prompt" aria-label="Chat with ChatGPT"></textarea><button aria-label="Send message" onclick="send()">Send</button><script>function send(){
   const p=document.querySelector('textarea');const payload=JSON.parse(p.value.trim().split('\\n').at(-1));p.value='';
   setTimeout(()=>{const message=document.createElement('div');message.setAttribute('data-message-role','assistant');message.setAttribute('data-message-complete','');const content=document.createElement('div');content.setAttribute('data-assistant-markdown','');content.textContent=JSON.stringify({requestId:payload.requestId,answer:{selectedOption:'Yes',confidence:1,reason:'Confirmed'}});message.append(content);document.body.append(message);},100);
   }</script>`
    });
  });
  const provider = new ChatGPTBrowserProvider(directory, async () => context);
  try {
    await provider.open();
    const page = context.pages()[0]!;
    expect(page.url()).toBe("https://chatgpt.com/c/abcd-1234");
    await page.evaluate(() => {
      history.pushState({}, "", "/c/1234-abcd");
      const context = document.createElement("p");
      context.id = "user-context";
      context.textContent = "I own a car.";
      document.body.append(context);
    });
    const answer = await provider.decide({
      question: "Do you own a car?",
      type: "single_choice",
      options: ["Yes", "No"]
    });
    expect(answer.selectedOption).toBe("Yes");
    expect(await page.locator("#user-context").textContent()).toBe("I own a car.");
    expect(page.url()).toBe("https://chatgpt.com/c/1234-abcd");
    expect(
      JSON.parse(await readFile(join(directory, "chatgpt-browser-chat.json"), "utf8"))
    ).toEqual({ url: page.url() });
    await provider.decide({
      question: "Do you still own a car?",
      type: "single_choice",
      options: ["Yes", "No"]
    });
    expect(await page.locator("#user-context").textContent()).toBe("I own a car.");
    expect(provider.status().status).toContain("answered automatically");
    await page.evaluate(() => {
      const widget = document.createElement("div");
      widget.setAttribute("data-sitekey", "mock");
      widget.textContent = "CAPTCHA";
      document.body.append(widget);
    });
    await expect(
      provider.decide({ question: "Q", type: "text", options: [] })
    ).rejects.toMatchObject({ reviewReason: "captcha_detected", reviewHost: "chatgpt.com" });
    await page.locator("[data-sitekey]").evaluate((element) => element.remove());
    await page.locator("textarea").fill("My unsent draft");
    await expect(provider.decide({ question: "Q", type: "text", options: [] })).rejects.toThrow(
      "unsent draft"
    );
    expect(await page.locator("textarea").inputValue()).toBe("My unsent draft");
    expect(await page.locator('[data-message-role="assistant"]').count()).toBe(2);
  } finally {
    await provider.close();
    await browser.close();
    await rm(directory, { recursive: true, force: true });
  }
});
