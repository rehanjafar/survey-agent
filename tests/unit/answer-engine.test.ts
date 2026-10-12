import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { AnswerDecisionEngine } from "../../src/decision/answer-engine.js";
import type { NormalizedQuestion } from "../../src/domain/survey.js";
import type { LlmProvider } from "../../src/providers/types.js";
import { SqliteStore } from "../../src/storage/sqlite-store.js";

const question: NormalizedQuestion = {
  fingerprint: "color-question",
  prompt: "Which color do you prefer?",
  type: "single_choice",
  required: true,
  rows: [],
  options: [
    { id: "red", label: "Red", selector: "#red" },
    { id: "blue", label: "Blue", selector: "#blue" }
  ]
};

describe("AnswerDecisionEngine", () => {
  const directories: string[] = [];
  afterEach(() =>
    directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true }))
  );
  function store(): SqliteStore {
    const directory = mkdtempSync(join(tmpdir(), "survey-agent-"));
    directories.push(directory);
    return new SqliteStore(join(directory, "agent.sqlite"));
  }

  it("uses a confident cached answer without calling an LLM", async () => {
    const database = store();
    database.saveAnswer({ fingerprint: question.fingerprint, answer: "Blue", confidence: 0.99 });
    const provider: LlmProvider = { decide: vi.fn() };
    const result = await new AnswerDecisionEngine(database, provider).decide(question);
    expect(result).toEqual({
      status: "action",
      source: "cache",
      action: { kind: "select_one", selector: "#blue" },
      answer: { selectedOption: "Blue", confidence: 0.99, reason: "Previously confirmed answer." }
    });
    expect(provider.decide).not.toHaveBeenCalled();
    database.close();
  });

  it("asks the fallback on low confidence without caching before execution", async () => {
    const database = store();
    const primary: LlmProvider = {
      decide: vi.fn(async () => ({ selectedOption: "Red", confidence: 0.2, reason: "Unsure" }))
    };
    const fallback: LlmProvider = {
      decide: vi.fn(async () => ({ selectedOption: "Blue", confidence: 0.99, reason: "Reviewed" }))
    };
    const result = await new AnswerDecisionEngine(database, primary, 0.85, fallback).decide(
      question
    );
    expect(result).toMatchObject({ status: "action", action: { selector: "#blue" } });
    expect(fallback.decide).toHaveBeenCalledOnce();
    expect(database.cachedAnswer(question.fingerprint)).toBeUndefined();
    database.close();
  });

  it("sends objective questions directly to the provider", async () => {
    const database = store();
    const provider = {
      decide: vi.fn(async () => ({
        selectedOption: "Blue",
        confidence: 0.99,
        reason: "Objective answer"
      }))
    };
    const result = await new AnswerDecisionEngine(database, provider).decide({
      ...question,
      prompt: "Which color is the clear daytime sky?"
    });
    expect(result.status).toBe("action");
    expect(provider.decide).toHaveBeenCalledWith(
      expect.objectContaining({ question: "Which color is the clear daytime sky?" })
    );
    database.close();
  });
  it("never retries a failed dispatched fallback", async () => {
    const database = store();
    const fallback = {
      decide: vi.fn(async () => {
        throw new Error("already sent");
      })
    };
    const primary = { decide: vi.fn(async () => ({ confidence: 0, reason: "Unknown" })) };
    expect(
      (
        await new AnswerDecisionEngine(database, primary, 0.9, fallback).decide({
          ...question,
          prompt: "Which sky color?"
        })
      ).status
    ).toBe("review");
    expect(fallback.decide).toHaveBeenCalledOnce();
    database.close();
  });
  it.each(["Country", "How old are you?", "Which color do you prefer?"])(
    "sends personal question %s directly to the provider without local setup",
    async (prompt) => {
      const database = store();
      try {
        const provider = {
          decide: vi.fn(async () => ({
            selectedOption: "Blue",
            confidence: 1,
            reason: "Available chat context"
          }))
        };
        const result = await new AnswerDecisionEngine(database, provider).decide({
          ...question,
          prompt
        });
        expect(result).toMatchObject({ status: "action", source: "llm" });
        expect(provider.decide).toHaveBeenCalledExactlyOnceWith({
          question: prompt,
          type: "single_choice",
          options: ["Red", "Blue"]
        });
        expect(database.reviews()).toHaveLength(0);
      } finally {
        database.close();
      }
    }
  );
  it("asks the fallback when the connected provider lacks personal context", async () => {
    const database = store();
    try {
      const primary = {
        decide: vi.fn(async () => ({ confidence: 0, reason: "No available context" }))
      };
      const fallback = {
        decide: vi.fn(async () => ({
          selectedOption: "Blue",
          confidence: 1,
          reason: "Available in this chat"
        }))
      };
      const result = await new AnswerDecisionEngine(database, primary, 0.9, fallback).decide(
        question
      );
      expect(result).toMatchObject({ status: "action", source: "llm" });
      expect(primary.decide).toHaveBeenCalledOnce();
      expect(fallback.decide).toHaveBeenCalledOnce();
    } finally {
      database.close();
    }
  });
  it("does not cache an unrecognized or unsupported answer", async () => {
    const database = store();
    const primary: LlmProvider = {
      decide: async () => ({ selectedOption: "Purple", confidence: 0.99, reason: "Invalid" })
    };
    expect((await new AnswerDecisionEngine(database, primary).decide(question)).status).toBe(
      "review"
    );
    expect(database.cachedAnswer(question.fingerprint)).toBeUndefined();
    database.close();
  });
});

it.each(["objective", "abstention"] as const)(
  "uses a validated %s response without confidence approval in autonomous mode",
  async (basis) => {
    const database = new SqliteStore(":memory:");
    try {
      const selectedOption = basis === "abstention" ? "Prefer not to answer" : "Blue";
      const activeQuestion =
        basis === "abstention"
          ? {
              ...question,
              options: [{ id: "decline", label: selectedOption, selector: "#decline" }]
            }
          : { ...question, prompt: "Which color is the clear daytime sky?" };
      const provider = {
        decide: vi.fn(async () => ({
          selectedOption,
          basis,
          confidence: 0.2,
          reason: "Supported response"
        }))
      };
      const result = await new AnswerDecisionEngine(
        database,
        provider,
        0.9,
        undefined,
        true
      ).decide(activeQuestion);
      expect(result).toMatchObject({ status: "action", answer: { confidence: 0.2, basis } });
      expect(provider.decide).toHaveBeenCalledOnce();
    } finally {
      database.close();
    }
  }
);
it("re-examines a completed uncertain answer once, without raising its confidence artificially", async () => {
  const database = new SqliteStore(":memory:");
  try {
    const provider = {
      decide: vi
        .fn()
        .mockResolvedValueOnce({ confidence: 0, reason: "uncertain" })
        .mockResolvedValueOnce({
          selectedOption: "Blue",
          basis: "objective",
          confidence: 0.4,
          reason: "Best supported choice"
        })
    };
    expect(
      await new AnswerDecisionEngine(database, provider, 0.9, undefined, true).decide({
        ...question,
        prompt: "Which color is the clear daytime sky?"
      })
    ).toMatchObject({ status: "action", answer: { confidence: 0.4 } });
    expect(provider.decide).toHaveBeenLastCalledWith(
      expect.objectContaining({ resolution: "best_supported_answer", options: ["Red", "Blue"] })
    );
  } finally {
    database.close();
  }
});
it("does not manufacture a missing personal answer or accept an invented option", async () => {
  const database = new SqliteStore(":memory:");
  try {
    for (const answer of [
      { confidence: 0, reason: "Personal information unavailable" },
      { selectedOption: "Purple", basis: "objective", confidence: 0.3, reason: "Invalid label" }
    ]) {
      const provider = { decide: vi.fn(async () => answer) };
      expect(
        await new AnswerDecisionEngine(
          database,
          provider as LlmProvider,
          0.9,
          undefined,
          true
        ).decide(question)
      ).toMatchObject({ status: "review" });
      expect(provider.decide).toHaveBeenCalledTimes(2);
    }
  } finally {
    database.close();
  }
});
