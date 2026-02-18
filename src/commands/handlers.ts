import type { ParsedCommand } from "../core/types.js";
import type { Gateway } from "../core/gateway.js";
import { BUILTIN_TOOL_NAMES } from "../core/types.js";
import { executeToolAction } from "../tools/executor.js";
import { PROVIDER_NAMES, DEFAULT_MODELS } from "../providers/types.js";
import type { ProviderName } from "../providers/types.js";
import { continueAfterToolResult } from "../agent/runner.js";

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

  // /auth and /model work even when dormant (setup commands)
  if (cmd.name === "auth") {
    return handleAuth(gw, cmd.args);
  }
  if (cmd.name === "model") {
    return handleModel(gw, cmd.args);
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

// ─── Auth ─────────────────────────────────────────────────

async function handleAuth(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  const subcommand = args[0]?.toLowerCase();

  // /auth status
  if (!subcommand || subcommand === "status") {
    return { reply: gw.providerStore.formatStatus() };
  }

  // /auth remove <provider>
  if (subcommand === "remove") {
    const provider = args[1]?.toLowerCase();
    if (!provider || !gw.providerStore.isValidProvider(provider)) {
      return { reply: `Usage: /auth remove <provider>\nProviders: ${PROVIDER_NAMES.join(", ")}` };
    }
    const removed = await gw.providerStore.removeCredential(provider as ProviderName);
    if (!removed) return { reply: `No credentials stored for ${provider}.` };
    return { reply: `Removed credentials for ${provider}.` };
  }

  // /auth <provider> <api-key>
  const provider = subcommand;
  const apiKey = args[1];

  if (!gw.providerStore.isValidProvider(provider)) {
    return {
      reply: `Unknown provider: "${provider}"\nAvailable: ${PROVIDER_NAMES.join(", ")}\n\nUsage:\n  /auth <provider> <api-key>\n  /auth status\n  /auth remove <provider>`,
    };
  }

  if (!apiKey) {
    return { reply: `Usage: /auth ${provider} <api-key>` };
  }

  await gw.providerStore.setCredential(provider as ProviderName, {
    type: "api_key",
    key: apiKey,
  });

  return {
    reply: `API key stored for ${provider}.\n` +
      `Active provider: ${gw.providerStore.getActiveProvider()} / ${gw.providerStore.getActiveModel()}`,
  };
}

// ─── Model ────────────────────────────────────────────────

async function handleModel(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  const spec = args[0];

  // /model (no args) — show current
  if (!spec) {
    const provider = gw.providerStore.getActiveProvider();
    const model = gw.providerStore.getActiveModel();
    if (!provider) return { reply: "No provider configured. Use /auth <provider> <api-key> first." };
    return { reply: `Current model: ${provider} / ${model}` };
  }

  // /model <provider/model> or /model <provider>
  const slashIdx = spec.indexOf("/");
  let provider: string;
  let model: string;

  if (slashIdx !== -1) {
    provider = spec.slice(0, slashIdx).toLowerCase();
    model = spec.slice(slashIdx + 1);
  } else {
    provider = spec.toLowerCase();
    model = DEFAULT_MODELS[provider as ProviderName] || spec;
  }

  if (!gw.providerStore.isValidProvider(provider)) {
    return { reply: `Unknown provider: "${provider}"\nAvailable: ${PROVIDER_NAMES.join(", ")}` };
  }

  if (!gw.providerStore.hasProvider(provider as ProviderName)) {
    return { reply: `No API key for ${provider}. Use /auth ${provider} <api-key> first.` };
  }

  await gw.providerStore.setActiveModel(provider as ProviderName, model);
  return { reply: `Active model set to: ${provider} / ${model}` };
}

// ─── Tool Enable/Disable ──────────────────────────────────

async function handleEnable(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  const name = args[0]?.toLowerCase();
  if (!name) {
    return {
      reply: `Usage: /enable <tool>\nBuiltin tools: ${BUILTIN_TOOL_NAMES.join(", ")}\nMCP servers: /enable mcp:<server>`,
    };
  }

  // MCP server-level enable: "mcp:<server>"
  if (name.startsWith("mcp:")) {
    const serverName = name.slice(4);
    if (!serverName) {
      return { reply: `Usage: /enable mcp:<server>` };
    }
    const count = gw.tools.enableByServer(serverName);
    if (count === 0) {
      return {
        reply: `No tools found for MCP server "${serverName}". Is the server connected? Use /tools to check.`,
      };
    }
    await gw.audit.log("tool_enabled", { mcpServer: serverName, count });
    return { reply: `Enabled ${count} tool(s) for MCP server "${serverName}".` };
  }

  // Builtin tool enable
  if (!BUILTIN_TOOL_NAMES.includes(name as (typeof BUILTIN_TOOL_NAMES)[number])) {
    return {
      reply: `Unknown tool: "${name}"\nBuiltin tools: ${BUILTIN_TOOL_NAMES.join(", ")}\nMCP servers: /enable mcp:<server>`,
    };
  }

  gw.tools.enable(name);
  await gw.audit.log("tool_enabled", { tool: name });
  return {
    reply: `${name} is now ENABLED.\n` +
      (gw.tools.isDangerous(name)
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
    return {
      reply: `Usage: /disable <tool>\nBuiltin tools: ${BUILTIN_TOOL_NAMES.join(", ")}\nMCP servers: /disable mcp:<server>`,
    };
  }

  // MCP server-level disable: "mcp:<server>"
  if (name.startsWith("mcp:")) {
    const serverName = name.slice(4);
    if (!serverName) {
      return { reply: `Usage: /disable mcp:<server>` };
    }
    const count = gw.tools.disableByServer(serverName);
    if (count === 0) {
      return {
        reply: `No tools found for MCP server "${serverName}". Use /tools to check.`,
      };
    }
    await gw.audit.log("tool_disabled", { mcpServer: serverName, count });
    return { reply: `Disabled ${count} tool(s) for MCP server "${serverName}".` };
  }

  // Builtin tool disable
  if (!BUILTIN_TOOL_NAMES.includes(name as (typeof BUILTIN_TOOL_NAMES)[number])) {
    return {
      reply: `Unknown tool: "${name}"\nBuiltin tools: ${BUILTIN_TOOL_NAMES.join(", ")}\nMCP servers: /disable mcp:<server>`,
    };
  }

  gw.tools.disable(name);
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

  // Execute the real action
  const result = await executeToolAction(gw, req.toolName, req.action, req.details);
  await gw.audit.log("action_executed", {
    approvalId,
    tool: req.toolName,
    action: req.action,
  });

  gw.state = "awake"; // back from action_pending

  // If we have an active LLM conversation, feed the tool result back
  const llmReply = await continueAfterToolResult(gw, req, result);
  if (llmReply) {
    return { reply: `Approved.\n\n${llmReply}` };
  }

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

// ─── Help Text ────────────────────────────────────────────

const HELP_TEXT = `SafeClaw Commands:

Lifecycle:
  /wake — Wake the gateway
  /sleep — Return to dormant mode
  /kill — Emergency shutdown

Auth:
  /auth <provider> <api-key> — Store API key (anthropic, openai)
  /auth status — Show connected providers
  /auth remove <provider> — Remove stored credentials
  /model <provider/model> — Set active model
  /model — Show current model

Tools:
  /tools — List all tools and their status
  /enable <tool> — Enable a builtin tool
  /disable <tool> — Disable a builtin tool
  /enable mcp:<server> — Enable all tools for an MCP server
  /disable mcp:<server> — Disable all tools for an MCP server

Permissions:
  /confirm <id> — Approve a pending action
  /deny <id> — Reject a pending action

Info:
  /status — Show gateway state
  /audit [n] — Show last N audit events
  /help — Show this help

Builtin tools: browser, filesystem, shell, code_exec, network, messaging
MCP tools: auto-discovered on /wake from ~/.claude/settings.json

Security: All tools disabled by default. Dangerous actions always require /confirm.`;
