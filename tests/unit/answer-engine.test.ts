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
});
