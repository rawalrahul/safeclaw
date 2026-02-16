import type { Gateway } from "../../core/gateway.js";
import type { ToolName, ActionType } from "../../core/types.js";
import { SAFE_ACTIONS } from "../../core/types.js";
import { simulateBrowser } from "../../tools/browser.js";
import { simulateReadFile, simulateWriteFile } from "../../tools/filesystem.js";
import { simulateShell } from "../../tools/shell.js";

/**
 * Handle free-text messages when the gateway is awake.
 *
 * This is where a real AI agent would be invoked. In this prototype,
 * we detect simple patterns to demonstrate the tool permission flow:
 *
 * - "search ..." / "browse ..." → browser tool
 * - "read ..." / "cat ..." → filesystem tool (read — safe, no confirm needed)
 * - "write ..." / "save ..." → filesystem tool (write — dangerous, needs confirm)
 * - "run ..." / "exec ..." → shell tool (dangerous, needs confirm)
 * - Anything else → echo response (no tool)
 *
 * In production, this would call an LLM agent (Claude/GPT) which decides
 * which tool to use. The gateway intercepts the tool call and applies
 * the same permission checks.
 */
export async function handleFreeText(
  gw: Gateway,
  text: string
): Promise<string> {
  const lower = text.toLowerCase().trim();

  // ─── Pattern: Browser ─────────────────────────────
  if (lower.startsWith("search ") || lower.startsWith("browse ")) {
    return tryInvokeTool(gw, "browser", "browse_web", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: File Read (safe action) ─────────────
  if (lower.startsWith("read ") || lower.startsWith("cat ")) {
    return tryInvokeTool(gw, "filesystem", "read_file", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: File Write (dangerous) ──────────────
  if (lower.startsWith("write ") || lower.startsWith("save ")) {
    return tryInvokeTool(gw, "filesystem", "write_file", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: Shell Execute (dangerous) ───────────
  if (lower.startsWith("run ") || lower.startsWith("exec ")) {
    return tryInvokeTool(gw, "shell", "exec_shell", text.slice(text.indexOf(" ") + 1));
  }

  // ─── No tool match ────────────────────────────────
  return (
    `I understood your message but no tool pattern matched.\n\n` +
    `Try:\n` +
    `  "search <query>" — uses browser tool\n` +
    `  "read <path>" — uses filesystem tool\n` +
    `  "write <path>" — uses filesystem tool (needs /confirm)\n` +
    `  "run <command>" — uses shell tool (needs /confirm)\n\n` +
    `Or use /tools to see which tools are enabled.`
  );
}

/**
 * Attempt to invoke a tool, checking:
 * 1. Is the tool enabled?
 * 2. Is this a safe or dangerous action?
 * 3. If dangerous → create approval request and wait for /confirm
 * 4. If safe → execute immediately
 */
async function tryInvokeTool(
  gw: Gateway,
  toolName: ToolName,
  action: ActionType,
  target: string
): Promise<string> {
  // Check if tool is enabled
  if (!gw.tools.isEnabled(toolName)) {
    return (
      `The "${toolName}" tool is DISABLED.\n` +
      `Use /enable ${toolName} to activate it first.`
    );
  }

  // Safe actions execute immediately without confirmation
  if (SAFE_ACTIONS.includes(action)) {
    await gw.audit.log("action_executed", { tool: toolName, action, target });
    return executeAction(toolName, action, target);
  }

  // Dangerous actions require /confirm
  const req = gw.approvals.create(toolName, action, `${action}: ${target}`, {
    target,
  });
  gw.state = "action_pending";

  await gw.audit.log("permission_requested", {
    approvalId: req.approvalId,
    tool: toolName,
    action,
    target,
  });

  return gw.approvals.formatPendingRequest(req);
}

function executeAction(toolName: ToolName, action: ActionType, target: string): string {
  switch (toolName) {
    case "browser":
      return simulateBrowser(target).result;
    case "filesystem":
      if (action === "read_file") return simulateReadFile(target).result;
      if (action === "write_file") return simulateWriteFile(target, "").result;
      return `[Simulated] filesystem/${action}: ${target}`;
    case "shell":
      return simulateShell(target).result;
    default:
      return `[Simulated] ${toolName}/${action}: ${target}`;
  }
}
