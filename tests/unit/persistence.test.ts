import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { SqliteStore } from "../../src/storage/sqlite-store.js";

describe("durability and recovery", () => {
  it("keeps facts and answers after reopening, marks interrupted runs and invalidates stale memory on correction", () => {
    const directory = mkdtempSync(join(tmpdir(), "survey-recovery-"));
    const path = join(directory, "agent.sqlite");
    let store = new SqliteStore(path);
    try {
      store.upsertFact({ key: "country", value: "Canada", kind: "stable", established: true });
      store.saveAnswer({ fingerprint: "country", answer: "Canada", confidence: 1 });
      store.saveRun({
        id: "run-one",
        status: "running",
        url: "http://localhost/mock",
        steps: 5,
        message: "Running",
        updatedAt: new Date().toISOString()
      });
      store.close();
      store = new SqliteStore(path);
      store.recoverRuns();
      expect(store.runs()[0]).toMatchObject({ status: "interrupted", steps: 5 });
      expect(store.cachedAnswer("country")?.answer).toBe("Canada");
      expect(
        store.upsertFact({ key: "country", value: "Canada", kind: "temporary", established: false })
      ).toBe("conflict");
      expect(store.facts()[0]).toMatchObject({ kind: "stable", established: true });
      expect(() =>
        store.correctFact(
          { key: "country", value: "United States", kind: "stable", established: true },
          "France"
        )
      ).toThrow();
      store.correctFact(
        { key: "country", value: "United States", kind: "stable", established: true },
        "Canada"
      );
      expect(store.cachedAnswer("country")).toBeUndefined();
      expect(store.facts()[0]?.value).toBe("United States");
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
