import { describe, expect, it } from "vitest";

import { loadRuntimeConfig } from "../../src/config/runtime-config.js";

describe("loadRuntimeConfig", () => {
  it("uses safe local defaults and normalizes configured domains", () => {
    const config = loadRuntimeConfig({
      SURVEY_AGENT_ALLOWED_DOMAINS: "LOCALHOST, survey.example.test "
    });

    expect(config).toEqual({
      logLevel: "info",
      dataDirectory: "./data",
      allowedDomains: ["localhost", "survey.example.test"],
      authDomains: [],
      surveyDomains: [],
      profileDirectory: undefined,
      browserMode: "managed_chromium",
      cdpEndpoint: undefined,
      llmProvider: "mock",
      chatgptAccount: "default",
      chatgptModel: undefined,
      ntfyTopicUrl: undefined,
      ntfyToken: undefined,
      maxSurveys: 10,
      maxSteps: 100,
      reviewTimeoutMs: 3600000
    });
  });

  it("requires the matching provider API key", () => {
    expect(() => loadRuntimeConfig({ SURVEY_AGENT_LLM_PROVIDER: "openai" })).toThrow(
      "OPENAI_API_KEY is required"
    );
  });

  it("requires a loopback CDP endpoint in attached Chrome mode", () => {
    expect(() =>
      loadRuntimeConfig({
        SURVEY_AGENT_BROWSER_MODE: "attached_chrome",
        SURVEY_AGENT_CDP_ENDPOINT: "http://192.168.1.10:9222"
      })
    ).toThrow("loopback HTTP(S) URL");
  });
});

it("loads separate authorization scopes and rejects unsafe rules", () => {
  const config = loadRuntimeConfig({
    SURVEY_AGENT_SURVEY_DOMAINS: "*.survey.example.test",
    SURVEY_AGENT_AUTH_DOMAINS: "login.example.test"
  });
  expect(config.surveyDomains).toEqual(["*.survey.example.test"]);
  expect(config.authDomains).toEqual(["login.example.test"]);
  expect(() => loadRuntimeConfig({ SURVEY_AGENT_ALLOWED_DOMAINS: "*" })).toThrow(
    "Invalid domain rule"
  );
});
