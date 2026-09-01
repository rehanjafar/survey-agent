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
      browserMode: "managed_chromium",
      cdpEndpoint: undefined,
      llmProvider: "mock"
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
