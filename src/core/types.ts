// ─── Gateway States ───────────────────────────────────────────
export type GatewayState = "dormant" | "awake" | "action_pending" | "shutdown";

// ─── Tool Names ───────────────────────────────────────────────
export const BUILTIN_TOOL_NAMES = [
  "browser",
  "filesystem",
  "shell",
  "patch",
] as const;

export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

// Widened to string to accommodate dynamic MCP tool names (e.g. "mcp__server__tool")
export type ToolName = string;

// Backward-compat alias so existing imports don't break
export const TOOL_NAMES = BUILTIN_TOOL_NAMES;

export type ToolStatus = "enabled" | "disabled";

export interface ToolDefinition {
  name: ToolName;
  description: string;
  dangerous: boolean; // if true, actions require /confirm
  status: ToolStatus;
  lastEnabledAt?: number;
  lastDisabledAt?: number;
  // MCP-only fields
  isMcp?: true;
  mcpServer?: string;
  mcpToolName?: string;
  mcpSchema?: Record<string, unknown>;
  // Dynamic skill fields
  isDynamic?: true;
  skillName?: string;
  skillParameters?: Record<string, unknown>;
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
  workspaceDir: string;
}

// ─── Permission / Approval ────────────────────────────────────
export type ActionType =
  | "browse_web"
  | "write_file"
  | "read_file"
  | "list_dir"
  | "delete_file"
  | "exec_shell"
  | "exec_code"
  | "send_message"
  | "network_request"
  | "mcp_call"
  | "skill_call"
  | "skill_install";

export const SAFE_ACTIONS: ActionType[] = ["read_file", "list_dir", "browse_web"];

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
  | "tool_called"
  | "tool_result"
  | "action_executed"
  | "action_failed"
  | "command_received"
  | "skill_proposed"
  | "skill_installed";

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
  | "auth"
  | "model"
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
