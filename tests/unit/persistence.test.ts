import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { SqliteStore } from "../../src/storage/sqlite-store.js";

describe("durability and recovery", () => {
  it("keeps answers after reopening, recovers runs and clears reusable memory explicitly", () => {
    const directory = mkdtempSync(join(tmpdir(), "survey-recovery-"));
    const path = join(directory, "agent.sqlite");
    let store = new SqliteStore(path);
    try {
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
      store.clearMemory();
      expect(store.cachedAnswer("country")).toBeUndefined();
    } finally {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

it("opens legacy databases without reading or erasing retired personal facts", () => {
  const directory = mkdtempSync(join(tmpdir(), "survey-legacy-"));
  const path = join(directory, "agent.sqlite");
  const legacy = new DatabaseSync(path);
  legacy.exec(
    "CREATE TABLE profile_facts(key TEXT PRIMARY KEY, value TEXT); INSERT INTO profile_facts VALUES('country','Canada'); PRAGMA user_version=3;"
  );
  legacy.close();
  const store = new SqliteStore(path);
  try {
    expect(store.stats()).toEqual({ answers: 0, mappings: 0 });
    store.saveAnswer({ fingerprint: "test", answer: "Yes", confidence: 1 });
    expect(store.cachedAnswer("test")?.answer).toBe("Yes");
    const check = new DatabaseSync(path);
    try {
      expect(check.prepare("SELECT value FROM profile_facts").get()?.value).toBe("Canada");
      expect(check.prepare("PRAGMA user_version").get()?.user_version).toBe(4);
    } finally {
      check.close();
    }
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
it("does not create personal-fact tables in new databases", () => {
  const directory = mkdtempSync(join(tmpdir(), "survey-new-"));
  const path = join(directory, "agent.sqlite");
  const store = new SqliteStore(path);
  const check = new DatabaseSync(path);
  try {
    expect(
      check
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('profile_facts','fact_history')"
        )
        .all()
    ).toEqual([]);
  } finally {
    check.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
