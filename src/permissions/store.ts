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
    extra?: { target?: string; content?: string }
  ): PermissionRequest {
    const now = Date.now();
    const req: PermissionRequest = {
      approvalId: uuid().slice(0, 8),
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

  formatPendingRequest(req: PermissionRequest): string {
    const timeLeft = Math.max(0, Math.round((req.expiresAt - Date.now()) / 1000));
    return [
      `Action pending approval:`,
      `  Tool: ${req.toolName}`,
      `  Action: ${req.action}`,
      `  Details: ${req.details.description}`,
      req.details.target ? `  Target: ${req.details.target}` : "",
      `  Expires in: ${timeLeft}s`,
      ``,
      `Reply /confirm ${req.approvalId} or /deny ${req.approvalId}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
}
