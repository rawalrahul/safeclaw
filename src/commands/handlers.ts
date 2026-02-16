import type { ParsedCommand, ToolName } from "../core/types.js";
import type { Gateway } from "../core/gateway.js";
import { TOOL_NAMES } from "../core/types.js";
import { simulateBrowser } from "../tools/browser.js";
import { simulateWriteFile, simulateDeleteFile } from "../tools/filesystem.js";
import { simulateShell } from "../tools/shell.js";

/**
 * Handle a parsed command and return the response message.
 * Returns null if the gateway should shut down (on /kill).
 */
export async function handleCommand(
  gw: Gateway,
  cmd: ParsedCommand
): Promise<{ reply: string; shouldShutdown?: boolean }> {
  // /wake works even when dormant
  if (cmd.name === "wake") {
    const reply = await gw.wake();
    return { reply };
  }

  // All other commands require awake state
  if (!gw.isAwake()) {
    return { reply: "Gateway is dormant. Send /wake to activate." };
  }

  gw.touchActivity();
  await gw.audit.log("command_received", { command: cmd.name, args: cmd.args });

  switch (cmd.name) {
    case "sleep":
      return { reply: await gw.sleep() };

    case "kill":
      return { reply: await gw.kill(), shouldShutdown: true };

    case "tools":
      return { reply: gw.tools.formatStatus() };

    case "enable":
      return handleEnable(gw, cmd.args);

    case "disable":
      return handleDisable(gw, cmd.args);

    case "confirm":
      return handleConfirm(gw, cmd.args);

    case "deny":
      return handleDeny(gw, cmd.args);

    case "status":
      return { reply: gw.formatStatus() };

    case "audit":
      return handleAudit(gw, cmd.args);

    case "help":
      return { reply: HELP_TEXT };

    default:
      return { reply: `Unknown command: ${cmd.name}` };
  }
}

// ─── Tool Enable/Disable ──────────────────────────────────

async function handleEnable(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  const name = args[0]?.toLowerCase();
  if (!name) {
    return { reply: `Usage: /enable <tool>\nAvailable: ${TOOL_NAMES.join(", ")}` };
  }
  if (!gw.tools.isValidTool(name)) {
    return { reply: `Unknown tool: "${name}"\nAvailable: ${TOOL_NAMES.join(", ")}` };
  }

  gw.tools.enable(name as ToolName);
  await gw.audit.log("tool_enabled", { tool: name });
  return {
    reply: `${name} is now ENABLED.\n` +
      (gw.tools.isDangerous(name as ToolName)
        ? "Dangerous actions will still require /confirm before executing."
        : ""),
  };
}

async function handleDisable(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  const name = args[0]?.toLowerCase();
  if (!name) {
    return { reply: `Usage: /disable <tool>\nAvailable: ${TOOL_NAMES.join(", ")}` };
  }
  if (!gw.tools.isValidTool(name)) {
    return { reply: `Unknown tool: "${name}"\nAvailable: ${TOOL_NAMES.join(", ")}` };
  }

  gw.tools.disable(name as ToolName);
  await gw.audit.log("tool_disabled", { tool: name });
  return { reply: `${name} is now DISABLED.` };
}

// ─── Confirm / Deny ───────────────────────────────────────

async function handleConfirm(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  const approvalId = args[0];
  if (!approvalId) {
    const pending = gw.approvals.listPending();
    if (pending.length === 0) return { reply: "No pending approvals." };
    return {
      reply: "Pending approvals:\n" +
        pending.map((p) => `  ${p.approvalId}: ${p.details.description}`).join("\n") +
        "\n\nUsage: /confirm <id>",
    };
  }

  const req = gw.approvals.approve(approvalId);
  if (!req) return { reply: `No pending approval with ID: ${approvalId}` };

  await gw.audit.log("permission_approved", {
    approvalId,
    tool: req.toolName,
    action: req.action,
  });

  // Execute the simulated action
  const result = executeSimulatedAction(req.toolName, req.action, req.details);
  await gw.audit.log("action_executed", {
    approvalId,
    tool: req.toolName,
    action: req.action,
  });

  gw.state = "awake"; // back from action_pending
  return { reply: `Approved. Executing...\n\n${result}` };
}

async function handleDeny(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  const approvalId = args[0];
  if (!approvalId) return { reply: "Usage: /deny <id>" };

  const req = gw.approvals.deny(approvalId);
  if (!req) return { reply: `No pending approval with ID: ${approvalId}` };

  await gw.audit.log("permission_denied", {
    approvalId,
    tool: req.toolName,
    action: req.action,
  });

  gw.state = "awake"; // back from action_pending
  return { reply: `Denied. Action "${req.details.description}" was not executed.` };
}

// ─── Audit ────────────────────────────────────────────────

async function handleAudit(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  const count = parseInt(args[0] || "10", 10);
  const events = await gw.audit.recent(count);
  if (events.length === 0) return { reply: "No audit events yet." };

  const lines = events.map((e) => gw.audit.formatEvent(e));
  return { reply: `Last ${events.length} events:\n\n${lines.join("\n")}` };
}

// ─── Simulated Execution ──────────────────────────────────

function executeSimulatedAction(
  toolName: string,
  action: string,
  details: { description: string; target?: string; content?: string }
): string {
  switch (toolName) {
    case "browser":
      return simulateBrowser(details.target || details.description).result;
    case "filesystem":
      if (action === "write_file")
        return simulateWriteFile(details.target || "/tmp/file.txt", details.content || "").result;
      if (action === "delete_file")
        return simulateDeleteFile(details.target || "/tmp/file.txt").result;
      return `[Simulated] Filesystem action: ${action}`;
    case "shell":
      return simulateShell(details.target || details.description).result;
    default:
      return `[Simulated] ${toolName}/${action}: ${details.description}`;
  }
}

// ─── Help Text ────────────────────────────────────────────

const HELP_TEXT = `SafeClaw Commands:

Lifecycle:
  /wake — Wake the gateway
  /sleep — Return to dormant mode
  /kill — Emergency shutdown

Tools:
  /tools — List all tools and their status
  /enable <tool> — Enable a tool
  /disable <tool> — Disable a tool

Permissions:
  /confirm <id> — Approve a pending action
  /deny <id> — Reject a pending action

Info:
  /status — Show gateway state
  /audit [n] — Show last N audit events
  /help — Show this help

Available tools: browser, filesystem, shell, code_exec, network, messaging

Security: All tools disabled by default. Dangerous actions always require /confirm.`;
