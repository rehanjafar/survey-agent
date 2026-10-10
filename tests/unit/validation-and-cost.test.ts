import { describe, expect, it, vi } from "vitest";
import { settingsSchema, defaultDataDirectory } from "../../src/config/app-settings.js";
import { questionFingerprint } from "../../src/normalization/question-normalizer.js";
import { validateAnswer } from "../../src/validation/answer-validation.js";
import { NoCostProvider } from "../../src/providers/no-cost-provider.js";
import { OpenAIProvider, AnthropicProvider } from "../../src/providers/http-providers.js";
import type { NormalizedQuestion } from "../../src/domain/survey.js";
import { AnswerDecisionEngine } from "../../src/decision/answer-engine.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";
import { rankOffers } from "../../src/platforms/eureka/index.js";

const base: NormalizedQuestion = {
  fingerprint: "test",
  prompt: "Country",
  type: "single_choice",
  required: true,
  rows: [],
  options: [
    { id: "ca", label: "Canada", selector: "#ca" },
    { id: "us", label: "United States", selector: "#us" }
  ]
};
describe("validation and no-cost guarantees", () => {
  it("ranks by displayed reward per minute and puts unknown durations last", () => {
    const offers = [
      {
        id: "long",
        title: "Long",
        selector: "#long",
        rewardCents: 500,
        durationMinutes: 60,
        enabled: true
      },
      {
        id: "short",
        title: "Short",
        selector: "#short",
        rewardCents: 100,
        durationMinutes: 2,
        enabled: true
      },
      {
        id: "unknown",
        title: "Unknown",
        selector: "#unknown",
        rewardCents: 900,
        durationMinutes: null,
        enabled: true
      }
    ];
    expect(rankOffers(offers, "reward_per_minute").map((offer) => offer.id)).toEqual([
      "short",
      "long",
      "unknown"
    ]);
  });
  it("cannot configure a paid provider in the application", () => {
    expect(settingsSchema.parse({}).provider).toBe("manual");
    expect(() => settingsSchema.parse({ provider: "openai" })).toThrow();
    expect(() => settingsSchema.parse({ provider: "anthropic" })).toThrow();
  });
  it("returns an explicit review decision without making a network call", async () => {
    const request = vi.spyOn(globalThis, "fetch");
    try {
      expect((await new NoCostProvider().decide()).confidence).toBe(0);
      expect(request).not.toHaveBeenCalled();
    } finally {
      request.mockRestore();
    }
  });
  it("keeps meaningful punctuation, option sets and origins separate in cache keys", () => {
    expect(questionFingerprint("Income?", ["1.50"])).not.toBe(
      questionFingerprint("Income?", ["150"])
    );
    expect(questionFingerprint("Income?", ["1.50"], "site-a")).not.toBe(
      questionFingerprint("Income?", ["1.50"], "site-b")
    );
    expect(questionFingerprint(" Color? ", ["Blue"])).toBe(questionFingerprint("color?", ["blue"]));
  });
  it("validates multi-select and numeric answers without accepting injected selectors", () => {
    expect(
      validateAnswer(
        { ...base, type: "multiple_choice" },
        { selectedOptions: ["Canada"], confidence: 1, reason: "" }
      )
    ).toMatchObject({
      kind: "set_many",
      selections: [
        { selector: "#ca", checked: true },
        { selector: "#us", checked: false }
      ]
    });
    expect(() =>
      validateAnswer(base, { selectedOption: "#ca", confidence: 1, reason: "" })
    ).toThrow();
    expect(() =>
      validateAnswer(
        { ...base, type: "numeric", inputSelector: "#age", min: 18, max: 120, step: 1 },
        { value: "17", confidence: 1, reason: "" }
      )
    ).toThrow();
    expect(() =>
      validateAnswer(
        { ...base, type: "numeric", inputSelector: "#age", step: 1 },
        { value: "18.5", confidence: 1, reason: "" }
      )
    ).toThrow();
    expect(() =>
      validateAnswer(base, { selectedOption: "Canada", value: "Canada", confidence: 1, reason: "" })
    ).toThrow();
  });
  it("uses profile facts before the model and rejects conflicts before browser execution", async () => {
    const store = new SqliteStore(":memory:");
    try {
      store.upsertFact({ key: "country", value: "Canada", kind: "stable", established: true });
      const provider = { decide: vi.fn() };
      const engine = new AnswerDecisionEngine(store, provider);
      expect(await engine.decide({ ...base, factKey: "country" })).toMatchObject({
        status: "action",
        source: "profile"
      });
      expect(provider.decide).not.toHaveBeenCalled();
      expect(
        engine.human(
          { ...base, factKey: "country" },
          { selectedOption: "United States", confidence: 1, reason: "" }
        )
      ).toMatchObject({ status: "review", reason: "contradiction" });
      expect(store.stats().mappings).toBe(0);
      store.correctFact(
        { key: "country", value: "United States", kind: "stable", established: true },
        "Canada"
      );
      expect(store.facts()[0]?.value).toBe("United States");
    } finally {
      store.close();
    }
  });
  it("does not infer personal answers from missing facts", async () => {
    const store = new SqliteStore(":memory:");
    const provider = { decide: vi.fn() };
    try {
      expect(await new AnswerDecisionEngine(store, provider).decide(base)).toMatchObject({
        status: "review",
        reason: "missing_information"
      });
      expect(provider.decide).not.toHaveBeenCalled();
    } finally {
      store.close();
    }
  });
  it("computes per-platform storage without embedding a developer path", () => {
    expect(defaultDataDirectory("darwin", "/example")).toContain("Library");
    expect(defaultDataDirectory("win32", "/example", "/localdata")).toContain("SurveyAgent");
    expect(defaultDataDirectory("linux", "/example")).toContain(".local");
  });
});
describe("provider wire parsing (mock responses only)", () => {
  const question = {
    question: "Country?",
    type: "single_choice" as const,
    options: ["Canada"],
    relevantProfileFacts: [{ key: "country", value: "Canada" }]
  };
  it("parses the OpenAI output array and requests strict structured output", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: "completed",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    selectedOption: "Canada",
                    confidence: 1,
                    reason: "Known fact."
                  })
                }
              ]
            }
          ]
        }),
        { status: 200 }
      )
    );
    expect(
      await new OpenAIProvider("test-key", "test-model", request).decide(question)
    ).toMatchObject({ selectedOption: "Canada" });
    const body = JSON.parse(request.mock.calls[0]![1]!.body as string);
    expect(body.store).toBe(false);
    expect(body.text.format.strict).toBe(true);
    expect(body.input).not.toContain("selector");
  });
  it("stops on truncated output and HTTP errors", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ status: "incomplete", output: [] }), { status: 200 })
      );
    await expect(new OpenAIProvider("test", "test", request).decide(question)).rejects.toThrow();
    request.mockResolvedValue(new Response("private upstream detail", { status: 429 }));
    await expect(new OpenAIProvider("test", "test", request).decide(question)).rejects.toThrow(
      "HTTP 429"
    );
  });
  it("parses a forced Anthropic tool response", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              name: "answer_survey",
              input: { selectedOption: "Canada", confidence: 1, reason: "" }
            }
          ]
        }),
        { status: 200 }
      )
    );
    expect(await new AnthropicProvider("test", "test", request).decide(question)).toMatchObject({
      selectedOption: "Canada"
    });
  });
});
