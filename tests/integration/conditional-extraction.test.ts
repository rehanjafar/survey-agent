import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
import { extractQuestions } from "../../src/extraction/question-extractor.js";
const server = createServer((request, response) => {
  if (request.url === "/redirect") {
    response.writeHead(302, { location: "http://outside.invalid/question" });
    response.end();
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    `<h1>Unrelated heading</h1><fieldset><legend>Do you own a car?</legend><label><input name="car" type="radio" value="yes" onchange="document.querySelector('#followup').hidden=false">Yes</label><label><input name="car" type="radio" value="no">No</label></fieldset><div id="followup" hidden><label for="brand">Which brand?</label><input id="brand"></div><fieldset data-question-type="scale"><legend>How satisfied are you?</legend><label><input name="scale" type="radio" value="1">1</label><label><input name="scale" type="radio" value="2">2</label></fieldset>`
  );
});
let base: string;
let browser: PlaywrightChromiumBrowser;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
});
afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("excludes hidden questions, associates legends and re-extracts a conditional field", async () => {
  const session = await browser.createSession();
  try {
    let state = await session.navigate(base);
    expect(extractQuestions(state).map((q) => q.type)).toEqual(["single_choice", "scale"]);
    expect(extractQuestions(state)[0]?.prompt).toBe("Do you own a car?");
    await session.selectRadio(extractQuestions(state)[0]!.options[0]!.selector);
    state = await session.capturePageState();
    expect(extractQuestions(state).map((q) => q.type)).toEqual(["single_choice", "text", "scale"]);
  } finally {
    await session.close();
  }
});
it("blocks a redirect before the external document can load", async () => {
  const session = await browser.createSession();
  try {
    await expect(session.navigate(base + "/redirect")).rejects.toThrow();
    expect(session.currentUrl()).not.toContain("outside.invalid");
  } finally {
    await session.close();
  }
});
