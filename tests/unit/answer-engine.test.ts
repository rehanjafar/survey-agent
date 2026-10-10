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
      action: { kind: "select_one", selector: "#blue" }
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
