import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";

const mockSurveyHtml = (sharedContext: boolean): string => `<!doctype html>
<html>
  <head><title>Mock survey</title></head>
  <body>
    <main>
      <p>${sharedContext ? "Shared context" : "Fresh context"}</p>
      <h1>Which color do you prefer?</h1>
      <label for="red">Red</label><input id="red" name="color" type="radio" value="red">
      <label for="blue">Blue</label><input id="blue" name="color" type="radio" value="blue">
      <label for="updates">Receive updates</label><input id="updates" type="checkbox">
      <label for="name">Name</label><input id="name" type="text" placeholder="Your name">
      <label for="age">Age</label><input id="age" type="number">
      <label for="country">Country</label>
      <select id="country"><option value="ca">Canada</option><option value="us">United States</option></select>
      <button id="next" type="button" onclick="location.href='/next'">Next</button>
    </main>
  </body>
</html>`;

describe("PlaywrightChromiumBrowser", () => {
  const server = createServer((request, response) => {
    const sharedContext = request.headers.cookie?.includes("survey_context=shared") ?? false;
    response.setHeader("set-cookie", "survey_context=shared; Path=/");
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      request.url === "/next"
        ? "<title>Complete</title><p>Survey complete</p>"
        : mockSurveyHtml(sharedContext)
    );
  });
  let baseUrl: string;
  let browser: PlaywrightChromiumBrowser | undefined;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"] });
    await browser.launch();
  });

  afterAll(async () => {
    await browser?.close();
    if (server.listening) {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
    }
  });

  it("inspects and drives a local survey with a reusable browser context", async () => {
    if (!browser) {
      throw new Error("Browser was not started.");
    }
    const firstSession = await browser.createSession();
    const secondSession = await browser.createSession();

    const state = await firstSession.navigate(baseUrl);
    expect(state.title).toBe("Mock survey");
    expect(state.text).toContain("Which color do you prefer?");
    expect(state.controls.map((control) => control.kind)).toEqual(
      expect.arrayContaining(["radio", "checkbox", "text", "number", "select", "button"])
    );
    expect(state.controls.find((control) => control.selector === "#country")?.options).toEqual([
      { label: "Canada", value: "ca", disabled: false, selected: true },
      { label: "United States", value: "us", disabled: false, selected: false }
    ]);
    expect((await secondSession.navigate(baseUrl)).text).toContain("Shared context");

    await firstSession.selectRadio("#blue");
    await firstSession.setCheckbox("#updates", true);
    await firstSession.type("#name", "Casey");
    await firstSession.type("#age", "34");
    await firstSession.selectDropdown("#country", "us");

    const afterAnswers = await firstSession.capturePageState();
    expect(afterAnswers.controls.find((control) => control.selector === "#blue")?.checked).toBe(
      true
    );
    expect(afterAnswers.controls.find((control) => control.selector === "#updates")?.checked).toBe(
      true
    );
    expect(afterAnswers.controls.find((control) => control.selector === "#name")?.value).toBe(
      "Casey"
    );
    expect(afterAnswers.controls.find((control) => control.selector === "#age")?.value).toBe("34");
    expect(afterAnswers.controls.find((control) => control.selector === "#country")?.value).toBe(
      "us"
    );

    const navigation = await firstSession.clickAndDetectNavigation("#next");
    expect(navigation.navigated).toBe(true);
    expect(navigation.url).toBe(`${baseUrl}/next`);
    expect((await firstSession.capturePageState()).text).toContain("Survey complete");

    await firstSession.close();
    await secondSession.close();
  });

  it("blocks navigation outside the configured allowlist", async () => {
    if (!browser) {
      throw new Error("Browser was not started.");
    }
    const session = await browser.createSession({ reuseContext: false });

    await expect(session.navigate("https://example.com")).rejects.toThrow("Navigation blocked");

    await session.close();
  });
});
