import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { EurekaAuditEvent, EurekaAuditLogger } from "./types.js";

export class JsonlEurekaAuditLogger implements EurekaAuditLogger {
  public constructor(private readonly filePath: string) {}

  public async record(event: EurekaAuditEvent): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, "utf8");
  }
}
