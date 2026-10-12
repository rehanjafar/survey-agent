import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
import { extractQuestions } from "../../src/extraction/question-extractor.js";
let port: number;
let forbidden = 0;
const server = createServer((request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  if (request.url === "/outer")
    return void response.end(
      `<h1>Survey wrapper</h1><iframe id="survey" src="http://localhost:${port}/middle"></iframe>`
    );
  if (request.url === "/middle")
    return void response.end('<iframe id="inner" src="/question"></iframe>');
  if (request.url === "/blocked")
    return void response.end(`<iframe src="http://localhost:${port}/forbidden"></iframe>`);
  if (request.url === "/forbidden") forbidden++;
  if (request.url === "/question")
    return void response.end(`<div id="widget"></div><script>
    document.querySelector('#widget').attachShadow({mode:'open'}).innerHTML = \`<fieldset><legend>What is two plus two?</legend><div role="radio" id="four" aria-checked="false" tabindex="0" onclick="this.setAttribute('aria-checked','true')">4</div><div role="radio" id="five" aria-checked="false" tabindex="0">5</div></fieldset><div role="group" aria-label="Preferences"><h2>Choose your saved preferences</h2><div role="checkbox" id="check" aria-checked="false" onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')">Email</div></div><input type="submit" value="Next page" onclick="document.body.innerHTML='<h1 data-survey-complete>Survey complete</h1>'">\`;
  </script>`);
  if (request.url === "/shadow-captcha")
    return void response.end(
      `<div id="captcha"></div><script>document.querySelector('#captcha').attachShadow({mode:'open'}).innerHTML='<div class="g-recaptcha" data-sitekey="mock">Verification widget</div>';</script>`
    );
  if (request.url === "/auth") return void response.end('<iframe src="/password"></iframe>');
  if (request.url === "/password")
    return void response.end('<label>Password<input type="password"></label>');
  if (request.url === "/srcdoc")
    return void response.end(
      '<iframe srcdoc="<fieldset><legend>Pick one?</legend><label><input type=radio name=a>A</label></fieldset>"></iframe>'
    );
  response.end("Mock");
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "0.0.0.0", resolve));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("reads and operates nested cross-origin frames and shadow controls without confusing selectors", async () => {
  const driver = new PlaywrightChromiumBrowser({
    allowedDomains: ["127.0.0.1", "localhost"],
    navigationMode: "compatible"
  });
  try {
    const session = await driver.createSession();
    const state = await session.navigate(`http://127.0.0.1:${port}/outer`);
    expect(state.hasUnsupported).toBe(false);
    const questions = extractQuestions(state);
    expect(questions.map((q) => q.type)).toEqual(["single_choice", "multiple_choice"]);
    await session.selectRadio(questions[0]!.options[0]!.selector);
    await session.setCheckbox(questions[1]!.options[0]!.selector, true);
    const after = await session.capturePageState();
    expect(after.controls.filter((control) => control.checked)).toHaveLength(2);
    const next = after.controls.find((control) => control.label === "Next page")!;
    expect(next.kind).toBe("button");
    await session.click(next.selector);
    expect((await session.capturePageState()).complete).toBe(true);
  } finally {
    await driver.close();
  }
});
it("keeps unauthorized frame requests blocked before transmission", async () => {
  const driver = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
  try {
    const session = await driver.createSession();
    await expect(session.navigate(`http://127.0.0.1:${port}/blocked`)).rejects.toThrow();
    expect(forbidden).toBe(0);
  } finally {
    await driver.close();
  }
});
it("propagates authentication stops from embedded documents", async () => {
  const driver = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
  try {
    const session = await driver.createSession();
    expect((await session.navigate(`http://127.0.0.1:${port}/auth`)).hasAuthentication).toBe(true);
  } finally {
    await driver.close();
  }
});
it("reads inherited-origin srcdoc frames", async () => {
  const driver = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
  try {
    const session = await driver.createSession();
    expect(
      extractQuestions(await session.navigate(`http://127.0.0.1:${port}/srcdoc`))[0]?.prompt
    ).toBe("Pick one?");
  } finally {
    await driver.close();
  }
});

it("detects verification widgets inside shadow DOM without interacting with them", async () => {
  const driver = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
  try {
    const session = await driver.createSession();
    expect((await session.navigate(`http://127.0.0.1:${port}/shadow-captcha`)).hasCaptcha).toBe(
      true
    );
  } finally {
    await driver.close();
  }
});
