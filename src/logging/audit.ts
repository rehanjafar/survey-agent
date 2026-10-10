import type { SqliteStore } from "../storage/sqlite-store.js";
// Only explicitly selected operational metadata can reach the audit log.
export function audit(
  store: SqliteStore,
  event: string,
  data: {
    runId?: string;
    source?: string;
    fingerprint?: string;
    confidence?: number;
    status?: string;
    reason?: string;
  } = {}
): void {
  store.recordEvent(event, JSON.stringify(data));
}
