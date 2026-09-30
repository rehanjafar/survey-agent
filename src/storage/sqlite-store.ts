import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
export type FactKind = "stable" | "preference" | "temporary";
export interface ProfileFact {
  readonly key: string;
  readonly value: string;
  readonly kind: FactKind;
  readonly established: boolean;
}
export interface CachedAnswer {
  readonly fingerprint: string;
  readonly answer: string;
  readonly confidence: number;
}
interface StoredProfileFact {
  readonly key: string;
  readonly value: string;
  readonly kind: FactKind;
  readonly established: number;
}
export class SqliteStore {
  private readonly database: DatabaseSync;
  public constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.database = new DatabaseSync(filePath);
    this.migrate();
  }
  public close(): void {
    this.database.close();
  }
  public upsertFact(fact: ProfileFact): "stored" | "conflict" {
    const existing = this.database
      .prepare("SELECT value, established FROM profile_facts WHERE key = ?")
      .get(fact.key) as { value: string; established: number } | undefined;
    if (existing?.established && existing.value !== fact.value) return "conflict";
    this.database
      .prepare(
        "INSERT INTO profile_facts(key,value,kind,established,updated_at) VALUES(?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,kind=excluded.kind,established=excluded.established,updated_at=CURRENT_TIMESTAMP"
      )
      .run(fact.key, fact.value, fact.kind, Number(fact.established));
    return "stored";
  }
  public relevantFacts(prompt: string): ProfileFact[] {
    const words = prompt
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 2);
    const facts = this.database
      .prepare(
        "SELECT key,value,kind,established FROM profile_facts ORDER BY established DESC, updated_at DESC LIMIT 50"
      )
      .all() as unknown as StoredProfileFact[];
    return facts
      .filter((fact) =>
        words.some(
          (word) => fact.key.toLowerCase().includes(word) || fact.value.toLowerCase().includes(word)
        )
      )
      .map((fact) => ({
        key: fact.key,
        value: fact.value,
        kind: fact.kind,
        established: Boolean(fact.established)
      }));
  }
  public cachedAnswer(fingerprint: string): CachedAnswer | undefined {
    return this.database
      .prepare("SELECT fingerprint,answer,confidence FROM question_answers WHERE fingerprint=?")
      .get(fingerprint) as CachedAnswer | undefined;
  }
  public saveAnswer(answer: CachedAnswer): void {
    this.database
      .prepare(
        "INSERT INTO question_answers(fingerprint,answer,confidence,updated_at) VALUES(?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(fingerprint) DO UPDATE SET answer=excluded.answer,confidence=excluded.confidence,updated_at=CURRENT_TIMESTAMP"
      )
      .run(answer.fingerprint, answer.answer, answer.confidence);
  }
  public recordReview(reason: string, detail: string): void {
    this.database
      .prepare("INSERT INTO review_items(reason,detail,created_at) VALUES(?,?,CURRENT_TIMESTAMP)")
      .run(reason, detail);
  }
  private migrate(): void {
    this.database.exec(
      `CREATE TABLE IF NOT EXISTS profile_facts (key TEXT PRIMARY KEY, value TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('stable','preference','temporary')), established INTEGER NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS question_answers (fingerprint TEXT PRIMARY KEY, answer TEXT NOT NULL, confidence REAL NOT NULL, updated_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS review_items (id INTEGER PRIMARY KEY, reason TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);`
    );
  }
}
