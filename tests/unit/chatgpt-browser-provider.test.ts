import { answerPreface } from "../../src/providers/decision-schema.js";
import { chatPrompt } from "../../src/providers/no-cost-provider.js";
import { expect, it } from "vitest";
import {
  browserChatPrompt,
  parseBrowserChatReply,
  regularChatUrl
} from "../../src/providers/chatgpt-browser-provider.js";
const answer = { selectedOption: "Yes", confidence: 1, reason: "Available chat context" };
it("accepts personal answers without local fact keys and requires request correlation", () => {
  expect(parseBrowserChatReply(JSON.stringify({ requestId: "one", answer }), "one")).toEqual(
    answer
  );
  expect(() =>
    parseBrowserChatReply(JSON.stringify({ requestId: "old", answer }), "one")
  ).toThrow();
  expect(() =>
    parseBrowserChatReply(JSON.stringify({ requestId: "one", answer: { confidence: 2 } }), "one")
  ).toThrow();
  expect(
    parseBrowserChatReply(
      JSON.stringify({ requestId: "one", answer: { confidence: 0, reason: "No context" } }),
      "one"
    ).confidence
  ).toBe(0);
});
it("sends only the active question and asks ChatGPT to use context actually available", () => {
  const question = {
    question: "Do you own a car?",
    type: "single_choice" as const,
    options: ["Yes", "No"]
  };
  const prompt = browserChatPrompt(question, "one");
  expect(JSON.parse(prompt.split("\n").at(-1)!)).toEqual({
    requestId: "one",
    activeQuestion: question
  });
  expect(prompt.startsWith(answerPreface)).toBe(true);
  expect(chatPrompt(question).startsWith(answerPreface)).toBe(true);
  expect(prompt).toContain("personal context actually available");
  expect(prompt).toContain("never invent");
  expect(prompt).not.toContain("confirmedProfile");
});
it("only restores dedicated ordinary-chat URLs on the exact ChatGPT origin", () => {
  expect(regularChatUrl("https://chatgpt.com/c/1234-abcd")).toBe(true);
  for (const url of [
    "https://chatgpt.com.evil.test/c/1234",
    "https://chatgpt.com/uc/1234",
    "https://chatgpt.com/c/1234?token=x",
    "https://chatgpt.com/g/a/c/1234"
  ])
    expect(regularChatUrl(url)).toBe(false);
});
