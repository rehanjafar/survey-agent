import { expect, it } from "vitest";
import {
  browserChatPrompt,
  parseBrowserChatReply,
  regularChatUrl
} from "../../src/providers/chatgpt-browser-provider.js";
const facts = [{ key: "vehicle", value: "I own one car" }];
const answer = { selectedOption: "Yes", confidence: 1, reason: "Confirmed vehicle fact" };
it("requires request correlation and confirmed fact provenance for personal answers", () => {
  expect(
    parseBrowserChatReply(
      JSON.stringify({ requestId: "one", personal: true, sourceFactKeys: ["vehicle"], answer }),
      "one",
      facts
    )
  ).toEqual(answer);
  expect(
    parseBrowserChatReply(
      JSON.stringify({ requestId: "one", personal: true, sourceFactKeys: ["invented"], answer }),
      "one",
      facts
    ).confidence
  ).toBe(0);
  expect(
    parseBrowserChatReply(
      JSON.stringify({ requestId: "one", personal: false, sourceFactKeys: [], answer }),
      "one",
      facts,
      true
    ).confidence
  ).toBe(0);
  expect(() =>
    parseBrowserChatReply(
      JSON.stringify({ requestId: "old", personal: true, sourceFactKeys: ["vehicle"], answer }),
      "one",
      facts
    )
  ).toThrow();
});
it("keeps confirmed profile and untrusted question data separate in the dedicated-chat prompt", () => {
  const prompt = browserChatPrompt(
    {
      question: "Do you own a car?",
      type: "single_choice",
      options: ["Yes", "No"],
      relevantProfileFacts: []
    },
    facts,
    "one"
  );
  expect(prompt).toContain('"confirmedProfile":[{"key":"vehicle","value":"I own one car"}]');
  expect(prompt).toContain("never invent or optimize eligibility");
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
