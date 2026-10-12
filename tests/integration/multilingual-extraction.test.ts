import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlaywrightChromiumBrowser } from "../../src/browser/index.js";
import { extractQuestions } from "../../src/extraction/question-extractor.js";
import { providerQuestion } from "../../src/decision/answer-engine.js";
import { validateAnswer } from "../../src/validation/answer-validation.js";
const server = createServer((_request, response) => {
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(
    `<html lang="ar" dir="rtl"><fieldset><legend>ما عاصمة فرنسا؟</legend><label><input type="radio" name="capital" value="paris">باريس</label><label><input type="radio" name="capital" value="rome">روما</label></fieldset><fieldset lang="ja"><legend>都市名を書いてください</legend><label for="city">都市</label><input id="city"></fieldset></html>`
  );
});
let browser: PlaywrightChromiumBrowser;
let base: string;
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  browser = new PlaywrightChromiumBrowser({ allowedDomains: ["127.0.0.1"], headless: true });
});
afterAll(async () => {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
it("preserves RTL labels and per-question language overrides through browser execution", async () => {
  const session = await browser.createSession();
  try {
    const questions = extractQuestions(await session.navigate(base));
    expect(providerQuestion(questions[0]!)).toMatchObject({
      language: "ar",
      question: "ما عاصمة فرنسا؟",
      options: ["باريس", "روما"]
    });
    expect(providerQuestion(questions[1]!)).toMatchObject({
      language: "ja",
      question: "都市名を書いてください"
    });
    const action = validateAnswer(questions[0]!, {
      selectedOption: "باريس",
      confidence: 1,
      reason: ""
    });
    if (action.kind !== "select_one") throw new Error("Unexpected action");
    await session.selectRadio(action.selector);
    await session.type(questions[1]!.inputSelector!, "東京");
    const page = await session.capturePageState();
    expect(page.controls.find((control) => control.value === "paris")?.checked).toBe(true);
    expect(page.controls.find((control) => control.id === "city")?.value).toBe("東京");
    expect(() =>
      validateAnswer(questions[0]!, { selectedOption: "Paris", confidence: 1, reason: "" })
    ).toThrow();
  } finally {
    await session.close();
  }
});
