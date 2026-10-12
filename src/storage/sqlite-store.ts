import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
export interface CachedAnswer {
  readonly fingerprint: string;
  readonly answer: string;
  readonly confidence: number;
}
export interface RunRecord {
  id: string;
  status: "running" | "paused" | "review" | "completed" | "stopped" | "interrupted";
  url: string;
  steps: number;
  message: string;
  updatedAt: string;
}
export class SqliteStore {
  private readonly database: DatabaseSync;
  public constructor(filePath: string) {
    if (filePath !== ":memory:") mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    this.database = new DatabaseSync(filePath);
    this.database.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;"
    );
    this.migrate();
  }
  public close(): void {
    this.database.close();
  }
  public clearMemory(): void {
    this.database.exec("DELETE FROM question_answers");
    this.recordEvent("memory_cleared", "{}");
  }
  public cachedAnswer(fingerprint: string): CachedAnswer | undefined {
    return this.database
      .prepare(
        "SELECT fingerprint,answer,confidence FROM question_answers WHERE fingerprint=? AND updated_at >= datetime('now','-30 days')"
      )
      .get(fingerprint) as CachedAnswer | undefined;
  }
  public saveAnswer(answer: CachedAnswer): void {
    const existing = this.cachedAnswer(answer.fingerprint);
    if (existing && existing.answer !== answer.answer) {
      this.recordReview("contradiction", "A saved answer differs from the proposed answer.");
      throw new Error("A saved answer conflicts; review is required.");
    }
    this.database
      .prepare(
        "INSERT INTO question_answers(fingerprint,answer,confidence,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(fingerprint) DO UPDATE SET confidence=excluded.confidence,updated_at=CURRENT_TIMESTAMP"
      )
      .run(answer.fingerprint, answer.answer, answer.confidence);
  }
  public recordReview(reason: string, detail: string): void {
    this.database
      .prepare("INSERT INTO review_items(reason,detail,created_at) VALUES(?,?,CURRENT_TIMESTAMP)")
      .run(reason, detail);
  }
  public reviews() {
    return this.database
      .prepare("SELECT id,reason,detail,created_at FROM review_items ORDER BY id DESC LIMIT 100")
      .all();
  }
  public saveRun(run: RunRecord): void {
    this.database
      .prepare(
        "INSERT INTO runs(id,status,url,steps,message,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,url=excluded.url,steps=excluded.steps,message=excluded.message,updated_at=excluded.updated_at"
      )
      .run(run.id, run.status, run.url, run.steps, run.message, run.updatedAt);
  }
  public runs(): RunRecord[] {
    return this.database
      .prepare(
        "SELECT id,status,url,steps,message,updated_at AS updatedAt FROM runs ORDER BY updated_at DESC LIMIT 50"
      )
      .all() as unknown as RunRecord[];
  }
  public recoverRuns(): void {
    this.database
      .prepare(
        "UPDATE runs SET status='interrupted',message='Application restarted. Start a new run to inspect the saved browser session.' WHERE status IN ('running','paused','review')"
      )
      .run();
  }
  public recordAnswer(runId: string, fingerprint: string, answer: string, source: string): void {
    this.database
      .prepare(
        "INSERT INTO answer_history(id,run_id,fingerprint,answer,source,created_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP)"
      )
      .run(randomUUID(), runId, fingerprint, answer, source);
  }
  public recordEvent(event: string, detail: string): void {
    this.database
      .prepare(
        "INSERT INTO audit_events(id,event,detail,created_at) VALUES(?,?,?,CURRENT_TIMESTAMP)"
      )
      .run(randomUUID(), event, detail);
    this.database.exec(
      "DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events ORDER BY created_at DESC LIMIT -1 OFFSET 2000)"
    );
  }
  public events() {
    return this.database
      .prepare("SELECT event,detail,created_at FROM audit_events ORDER BY rowid DESC LIMIT 100")
      .all();
  }
  public stats() {
    return {
      answers: Number(
        this.database.prepare("SELECT COUNT(*) AS count FROM answer_history").get()?.count ?? 0
      ),
      mappings: Number(
        this.database.prepare("SELECT COUNT(*) AS count FROM question_answers").get()?.count ?? 0
      )
    };
  }
  private migrate(): void {
    const version = Number(this.database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    if (version > 4) throw new Error("Database is newer than this application.");
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .exec(`CREATE TABLE IF NOT EXISTS question_answers (fingerprint TEXT PRIMARY KEY, answer TEXT NOT NULL, confidence REAL NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS review_items (id INTEGER PRIMARY KEY, reason TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,status TEXT NOT NULL,url TEXT NOT NULL,steps INTEGER NOT NULL,message TEXT NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS answer_history(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,fingerprint TEXT NOT NULL,answer TEXT NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS audit_events(id TEXT PRIMARY KEY,event TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL);
        PRAGMA user_version=4;`);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}
