// ─── Gateway States ───────────────────────────────────────────
export type GatewayState = "dormant" | "awake" | "action_pending" | "shutdown";

// ─── Tool Names ───────────────────────────────────────────────
export const TOOL_NAMES = [
  "browser",
  "filesystem",
  "shell",
  "code_exec",
  "network",
  "messaging",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type ToolStatus = "enabled" | "disabled";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  dangerous: boolean; // if true, actions require /confirm
  status: ToolStatus;
  lastEnabledAt?: number;
  lastDisabledAt?: number;
}

// ─── Authentication ───────────────────────────────────────────
export interface OwnerIdentity {
  telegramId: number;
}

// ─── Configuration ────────────────────────────────────────────
export interface SafeClawConfig {
  owner: OwnerIdentity;
  telegramBotToken: string;
  inactivityTimeoutMs: number;
  approvalTimeoutMs: number;
  storageDir: string;
}

// ─── Permission / Approval ────────────────────────────────────
export type ActionType =
  | "browse_web"
  | "write_file"
  | "read_file"
  | "delete_file"
  | "exec_shell"
  | "exec_code"
  | "send_message"
  | "network_request";

export const SAFE_ACTIONS: ActionType[] = ["read_file", "browse_web"];

export interface PermissionRequest {
  approvalId: string;
  toolName: ToolName;
  action: ActionType;
  details: {
    target?: string;
    content?: string;
    description: string;
  };
  createdAt: number;
  expiresAt: number;
  decision?: {
    approved: boolean;
    decidedAt: number;
  };
}

// ─── Audit Events ─────────────────────────────────────────────
export type AuditEventType =
  | "auth_attempt"
  | "auth_rejected"
  | "gateway_wake"
  | "gateway_sleep"
  | "gateway_kill"
  | "gateway_auto_sleep"
  | "tool_enabled"
  | "tool_disabled"
  | "permission_requested"
  | "permission_approved"
  | "permission_denied"
  | "permission_expired"
  | "action_executed"
  | "action_failed"
  | "command_received";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: number;
  details: Record<string, unknown>;
}

// ─── Commands ─────────────────────────────────────────────────
export type CommandName =
  | "wake"
  | "sleep"
  | "kill"
  | "tools"
  | "enable"
  | "disable"
  | "confirm"
  | "deny"
  | "status"
  | "audit"
  | "help";

export interface ParsedCommand {
  name: CommandName;
  args: string[];
  raw: string;
}

// ─── Gateway Instance ─────────────────────────────────────────
export interface GatewaySession {
  startedAt: number;
  lastActivityAt: number;
}
