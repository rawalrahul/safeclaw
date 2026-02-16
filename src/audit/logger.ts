import { join } from "node:path";
import { v4 as uuid } from "uuid";
import { appendJsonl, readJsonl } from "../storage/persistence.js";
import type { AuditEvent, AuditEventType } from "../core/types.js";

export class AuditLogger {
  private filePath: string;

  constructor(storageDir: string) {
    this.filePath = join(storageDir, "audit.jsonl");
  }

  async log(
    type: AuditEventType,
    details: Record<string, unknown> = {}
  ): Promise<AuditEvent> {
    const event: AuditEvent = {
      id: uuid().slice(0, 8),
      type,
      timestamp: Date.now(),
      details,
    };
    await appendJsonl(this.filePath, event);
    return event;
  }

  async recent(count: number = 20): Promise<AuditEvent[]> {
    const all = await readJsonl<AuditEvent>(this.filePath);
    return all.slice(-count);
  }

  formatEvent(e: AuditEvent): string {
    const time = new Date(e.timestamp).toLocaleTimeString("en-US", { hour12: false });
    const detail = Object.entries(e.details)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    return `[${time}] ${e.type}${detail ? ` (${detail})` : ""}`;
  }
}
