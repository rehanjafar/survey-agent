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

  it("records a review instead of overwriting an established profile fact", () => {
    const database = store();
    expect(
      database.upsertFact({ key: "country", value: "Canada", kind: "stable", established: true })
    ).toBe("stored");
    expect(
      database.upsertFact({
        key: "country",
        value: "United States",
        kind: "stable",
        established: true
      })
    ).toBe("conflict");
    database.close();
  });
  it("asks the fallback on low confidence without caching before execution", async () => {
    const database = store();
    database.upsertFact({
      key: "color preference",
      value: "Blue",
      kind: "preference",
      established: true
    });
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

  it("asks the provider about objective questions even with an empty profile", async () => {
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
      expect.objectContaining({ relevantProfileFacts: [] })
    );
    database.close();
  });
  it("does not ask a provider to invent a missing bound personal fact", async () => {
    const database = store();
    const provider = { decide: vi.fn() };
    expect(
      await new AnswerDecisionEngine(database, provider).decide({
        ...question,
        factKey: "preferred_color"
      })
    ).toMatchObject({ status: "review", reason: "missing_information" });
    expect(provider.decide).not.toHaveBeenCalled();
    database.close();
  });
  it("consults a confirmed-profile fallback before asking the user for missing facts", async () => {
    const database = store();
    const primary = { decide: vi.fn() };
    const fallback = {
      canRetrieveConfirmedFacts: true,
      decide: vi.fn(async () => ({
        selectedOption: "Blue",
        confidence: 1,
        reason: "Confirmed preference from dedicated chat"
      }))
    };
    expect(
      await new AnswerDecisionEngine(database, primary, 0.9, fallback).decide({
        ...question,
        factKey: "preferred_color"
      })
    ).toMatchObject({ status: "action", action: { selector: "#blue" } });
    expect(primary.decide).not.toHaveBeenCalled();
    expect(fallback.decide).toHaveBeenCalledOnce();
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
  it("maps a confirmed numeric fact into a truthful response band without a model", async () => {
    const database = store();
    database.upsertFact({ key: "age", value: "30", kind: "stable", established: true });
    const provider = { decide: vi.fn() };
    const q = {
      ...question,
      factKey: "age",
      prompt: "How old are you?",
      options: [
        { id: "young", label: "18–24 years old", selector: "#young" },
        { id: "adult", label: "25–34 years old", selector: "#adult" }
      ]
    };
    expect(await new AnswerDecisionEngine(database, provider).decide(q)).toMatchObject({
      status: "action",
      source: "profile",
      action: { selector: "#adult" }
    });
    expect(provider.decide).not.toHaveBeenCalled();
    expect(
      new AnswerDecisionEngine(database, provider).human(q, {
        selectedOption: "18–24 years old",
        confidence: 1,
        reason: ""
      })
    ).toMatchObject({ status: "action", source: "human", action: { selector: "#young" } });
    database.close();
  });
  it.each(["cache", "llm", "human", "survey_memory"] as const)(
    "accepts a valid %s answer that differs from a saved personal fact",
    async (source) => {
      const database = store();
      try {
        database.upsertFact({
          key: "preferred_color",
          value: "Green",
          kind: "preference",
          established: true
        });
        const q = { ...question, factKey: "preferred_color" };
        const answer = { selectedOption: "Blue", confidence: 1, reason: "" };
        const provider = { decide: vi.fn(async () => answer) };
        const engine = new AnswerDecisionEngine(database, provider);
        if (source === "cache")
          database.saveAnswer({
            fingerprint: q.fingerprint,
            answer: JSON.stringify(answer),
            confidence: 1
          });
        const result =
          source === "human"
            ? engine.human(q, answer)
            : source === "survey_memory"
              ? engine.replay(q, answer)
              : await engine.decide(q);
        expect(result).toMatchObject({
          status: "action",
          source,
          action: { selector: "#blue" }
        });
        expect(database.reviews()).toHaveLength(0);
        expect(database.facts()[0]?.value).toBe("Green");
      } finally {
        database.close();
      }
    }
  );
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
