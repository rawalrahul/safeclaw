import { v4 as uuid } from "uuid";
import type { PermissionRequest, ActionType } from "../core/types.js";

export class ApprovalStore {
  private pending: Map<string, PermissionRequest> = new Map();
  private approvalTimeoutMs: number;

  constructor(approvalTimeoutMs: number) {
    this.approvalTimeoutMs = approvalTimeoutMs;
  }

  create(
    toolName: string,
    action: ActionType,
    description: string,
    extra?: { target?: string; content?: string },
    batchId?: string
  ): PermissionRequest {
    const now = Date.now();
    const req: PermissionRequest = {
      approvalId: uuid().slice(0, 8),
      batchId,
      toolName,
      action,
      details: {
        description,
        target: extra?.target,
        content: extra?.content,
      },
      createdAt: now,
      expiresAt: now + this.approvalTimeoutMs,
    };
    this.pending.set(req.approvalId, req);
    return req;
  }

  get(approvalId: string): PermissionRequest | undefined {
    return this.pending.get(approvalId);
  }

  approve(approvalId: string): PermissionRequest | undefined {
    const req = this.pending.get(approvalId);
    if (!req) return undefined;
    req.decision = { approved: true, decidedAt: Date.now() };
    this.pending.delete(approvalId);
    return req;
  }

  deny(approvalId: string): PermissionRequest | undefined {
    const req = this.pending.get(approvalId);
    if (!req) return undefined;
    req.decision = { approved: false, decidedAt: Date.now() };
    this.pending.delete(approvalId);
    return req;
  }

  // ─── Batch operations ────────────────────────────────────

  /** Return all pending requests that share a batchId. */
  listBatch(batchId: string): PermissionRequest[] {
    this.cleanupExpired();
    return [...this.pending.values()].filter((r) => r.batchId === batchId);
  }

  /** Approve all requests in a batch and remove them from pending. */
  approveBatch(batchId: string): PermissionRequest[] {
    const batch = this.listBatch(batchId);
    const now = Date.now();
    for (const req of batch) {
      req.decision = { approved: true, decidedAt: now };
      this.pending.delete(req.approvalId);
    }
    return batch;
  }

  /** Deny all requests in a batch and remove them from pending. */
  denyBatch(batchId: string): PermissionRequest[] {
    const batch = this.listBatch(batchId);
    const now = Date.now();
    for (const req of batch) {
      req.decision = { approved: false, decidedAt: now };
      this.pending.delete(req.approvalId);
    }
    return batch;
  }

  listPending(): PermissionRequest[] {
    this.cleanupExpired();
    return [...this.pending.values()];
  }

  cleanupExpired(): PermissionRequest[] {
    const now = Date.now();
    const expired: PermissionRequest[] = [];
    for (const [id, req] of this.pending) {
      if (req.expiresAt <= now) {
        req.decision = { approved: false, decidedAt: now };
        expired.push(req);
        this.pending.delete(id);
      }
    }
    return expired;
  }

  hasPending(): boolean {
    this.cleanupExpired();
    return this.pending.size > 0;
  }

  // ─── Formatting ──────────────────────────────────────────

  /** Format a single pending request (used when only one dangerous action is queued). */
  formatPendingRequest(req: PermissionRequest): string {
    const timeLeft = Math.max(0, Math.round((req.expiresAt - Date.now()) / 1000));
    return [
      `⚠️ Action pending approval:`,
      `  Tool:    ${req.toolName}`,
      `  Action:  ${req.action}`,
      `  Details: ${req.details.description}`,
      req.details.target ? `  Target:  ${req.details.target}` : "",
      `  Expires in: ${timeLeft}s`,
      ``,
      `/confirm ${req.approvalId}  →  execute`,
      `/deny ${req.approvalId}     →  cancel`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  /**
   * Format multiple pending requests from the same LLM turn as a batch.
   * Shows /confirm all <batchId> and /deny all <batchId> shortcuts alongside individual IDs.
   */
  formatBatchRequest(requests: PermissionRequest[], batchId: string): string {
    if (requests.length === 0) return "";
    const timeLeft = Math.max(0, Math.round((requests[0].expiresAt - Date.now()) / 1000));

    const lines: string[] = [
      `⚠️ ${requests.length} actions need approval (expires in ${timeLeft}s):`,
      ``,
    ];

    for (let i = 0; i < requests.length; i++) {
      const r = requests[i];
      lines.push(`  ${i + 1}. [${r.approvalId}]  ${r.action}: ${r.details.description}`);
    }

    lines.push(
      ``,
      `Confirm all:  /confirm all ${batchId}`,
      `Deny all:     /deny all ${batchId}`,
      ``,
      `Or individually:`,
      ...requests.map((r) => `  /confirm ${r.approvalId}   /deny ${r.approvalId}`),
    );

    return lines.join("\n");
  }

  /**
   * Format all currently pending requests, grouped by batch.
   * Used for /confirm with no arguments.
   */
  formatAllPending(): string {
    const all = this.listPending();
    if (all.length === 0) return "No pending approvals.";

    // Group by batchId (requests without batchId get their own group)
    const batches = new Map<string, PermissionRequest[]>();
    for (const req of all) {
      const key = req.batchId ?? req.approvalId;
      if (!batches.has(key)) batches.set(key, []);
      batches.get(key)!.push(req);
    }

    const sections: string[] = [`${all.length} pending approval(s):\n`];
    for (const [key, reqs] of batches) {
      if (reqs.length === 1) {
        sections.push(this.formatPendingRequest(reqs[0]));
      } else {
        sections.push(this.formatBatchRequest(reqs, key));
      }
    }

    return sections.join("\n\n");
  }
}
