import type { ParsedCommand } from "../core/types.js";
import type { Gateway } from "../core/gateway.js";
import { BUILTIN_TOOL_NAMES } from "../core/types.js";
import { executeToolAction } from "../tools/executor.js";
import { PROVIDER_NAMES, DEFAULT_MODELS } from "../providers/types.js";
import type { ProviderName } from "../providers/types.js";
import { continueAfterToolResult, continueAfterBatchToolResults } from "../agent/runner.js";
import { fetchModels } from "../providers/models.js";
import { formatPromptSkills } from "../skills/prompt-skills.js";

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

    case "skills":
      return { reply: formatPromptSkills(gw.promptSkills) };

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
  const spec = args[0]?.toLowerCase();

  // /model or /model list [provider] — list available models from the API
  if (!spec || spec === "list") {
    const providerFilter = spec === "list" ? args[1]?.toLowerCase() : undefined;
    return listAvailableModels(gw, providerFilter);
  }

  // /model <provider/model> or /model <provider> — set model
  const slashIdx = spec.indexOf("/");
  let provider: string;
  let model: string;

  if (slashIdx !== -1) {
    provider = spec.slice(0, slashIdx);
    model = spec.slice(slashIdx + 1);
  } else {
    provider = spec;
    model = DEFAULT_MODELS[provider as ProviderName] || spec;
  }

  if (!gw.providerStore.isValidProvider(provider)) {
    return {
      reply:
        `Unknown provider: "${provider}"\nAvailable: ${PROVIDER_NAMES.join(", ")}\n\n` +
        `Run /model to see all available models.`,
    };
  }

  if (!gw.providerStore.hasProvider(provider as ProviderName)) {
    return { reply: `No API key for ${provider}. Use /auth ${provider} <api-key> first.` };
  }

  await gw.providerStore.setActiveModel(provider as ProviderName, model);
  return { reply: `Active model set to: ${provider} / ${model}` };
}

async function listAvailableModels(
  gw: Gateway,
  providerFilter?: string
): Promise<{ reply: string }> {
  // Validate provider filter
  if (providerFilter && !gw.providerStore.isValidProvider(providerFilter)) {
    return {
      reply: `Unknown provider: "${providerFilter}"\nAvailable: ${PROVIDER_NAMES.join(", ")}`,
    };
  }
  if (providerFilter && !gw.providerStore.hasProvider(providerFilter as ProviderName)) {
    return {
      reply: `No API key for "${providerFilter}". Use /auth ${providerFilter} <api-key> first.`,
    };
  }

  const providers = providerFilter
    ? [providerFilter as ProviderName]
    : PROVIDER_NAMES.filter((p) => gw.providerStore.hasProvider(p));

  if (providers.length === 0) {
    return {
      reply:
        `No providers configured. Use /auth <provider> <api-key> first.\n` +
        `Providers: ${PROVIDER_NAMES.join(", ")}`,
    };
  }

  const activeProvider = gw.providerStore.getActiveProvider();
  const activeModel = gw.providerStore.getActiveModel();

  const sections: string[] = [];
  if (activeProvider && activeModel) {
    sections.push(`Active: ${activeProvider} / ${activeModel}\n`);
  }

  for (const provider of providers) {
    const cred = gw.providerStore.getCredential(provider);
    if (!cred) continue;

    try {
      const models = await fetchModels(provider, cred.key);
      const lines = [`${provider} — ${models.length} model(s):`];
      for (const m of models) {
        const isCurrent = provider === activeProvider && m.id === activeModel;
        const label =
          m.displayName && m.displayName !== m.id ? `${m.id}  (${m.displayName})` : m.id;
        lines.push(`  ${isCurrent ? "▶" : " "} ${label}`);
      }
      sections.push(lines.join("\n"));
    } catch (err) {
      sections.push(`${provider}: could not fetch models — ${(err as Error).message}`);
    }
  }

  sections.push(`\nSwitch with: /model <provider>/<model-id>`);
  return { reply: sections.join("\n") };
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

  // Dynamic skill enable: "skill__<name>"
  if (name.startsWith("skill__")) {
    const toolDef = gw.tools.get(name);
    if (!toolDef) {
      return {
        reply: `Skill "${name}" not found. Use /tools to see installed skills.`,
      };
    }
    gw.tools.enable(name);
    await gw.audit.log("tool_enabled", { tool: name });
    return {
      reply: `${name} is now ENABLED.\n` +
        (toolDef.dangerous ? "Dangerous actions will still require /confirm before executing." : ""),
    };
  }

  // Builtin tool enable
  if (!BUILTIN_TOOL_NAMES.includes(name as (typeof BUILTIN_TOOL_NAMES)[number])) {
    return {
      reply: `Unknown tool: "${name}"\nBuiltin tools: ${BUILTIN_TOOL_NAMES.join(", ")}\nMCP servers: /enable mcp:<server>\nSkills: /enable skill__<name>`,
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

  // Dynamic skill disable: "skill__<name>"
  if (name.startsWith("skill__")) {
    const toolDef = gw.tools.get(name);
    if (!toolDef) {
      return { reply: `Skill "${name}" not found. Use /tools to see installed skills.` };
    }
    gw.tools.disable(name);
    await gw.audit.log("tool_disabled", { tool: name });
    return { reply: `${name} is now DISABLED.` };
  }

  // Builtin tool disable
  if (!BUILTIN_TOOL_NAMES.includes(name as (typeof BUILTIN_TOOL_NAMES)[number])) {
    return {
      reply: `Unknown tool: "${name}"\nBuiltin tools: ${BUILTIN_TOOL_NAMES.join(", ")}\nMCP servers: /disable mcp:<server>\nSkills: /disable skill__<name>`,
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
  const first = args[0];

  // /confirm  →  show all pending
  if (!first) {
    return { reply: gw.approvals.formatAllPending() };
  }

  // /confirm all <batchId>  →  approve entire batch
  if (first === "all") {
    const batchId = args[1];
    if (!batchId) return { reply: "Usage: /confirm all <batchId>" };

    const batch = gw.approvals.approveBatch(batchId);
    if (batch.length === 0) {
      return { reply: `No pending approvals found for batch "${batchId}".` };
    }

    const results: string[] = [];
    for (const req of batch) {
      await gw.audit.log("permission_approved", {
        approvalId: req.approvalId,
        tool: req.toolName,
        action: req.action,
      });
      const result = await executeToolAction(gw, req.toolName, req.action, req.details);
      await gw.audit.log("action_executed", {
        approvalId: req.approvalId,
        tool: req.toolName,
        action: req.action,
      });
      results.push(result);
    }

    gw.state = "awake";

    const llmReply = await continueAfterBatchToolResults(gw, batch, results);
    if (llmReply) {
      return { reply: `Approved all (${batch.length} actions).\n\n${llmReply}` };
    }

    const summary = batch
      .map((r, i) => `${r.details.description}: ${results[i]}`)
      .join("\n");
    return { reply: `Approved all (${batch.length} actions).\n\n${summary}` };
  }

  // /confirm <id>  →  approve single action
  const req = gw.approvals.approve(first);
  if (!req) return { reply: `No pending approval with ID: ${first}` };

  await gw.audit.log("permission_approved", {
    approvalId: first,
    tool: req.toolName,
    action: req.action,
  });

  const result = await executeToolAction(gw, req.toolName, req.action, req.details);
  await gw.audit.log("action_executed", {
    approvalId: first,
    tool: req.toolName,
    action: req.action,
  });

  gw.state = "awake";

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
  const first = args[0];

  // /deny  →  show pending
  if (!first) {
    return { reply: gw.approvals.formatAllPending() };
  }

  // /deny all <batchId>  →  deny entire batch
  if (first === "all") {
    const batchId = args[1];
    if (!batchId) return { reply: "Usage: /deny all <batchId>" };

    const batch = gw.approvals.denyBatch(batchId);
    if (batch.length === 0) {
      return { reply: `No pending approvals found for batch "${batchId}".` };
    }

    for (const req of batch) {
      await gw.audit.log("permission_denied", {
        approvalId: req.approvalId,
        tool: req.toolName,
        action: req.action,
      });
    }

    gw.state = "awake";
    return { reply: `Denied all ${batch.length} action(s) in batch.` };
  }

  // /deny <id>  →  deny single action
  const req = gw.approvals.deny(first);
  if (!req) return { reply: `No pending approval with ID: ${first}` };

  await gw.audit.log("permission_denied", {
    approvalId: first,
    tool: req.toolName,
    action: req.action,
  });

  gw.state = "awake";
  return { reply: `Denied. Action "${req.details.description}" was not executed.` };
}

// ─── Audit ────────────────────────────────────────────────

async function handleAudit(
  gw: Gateway,
  args: string[]
): Promise<{ reply: string }> {
  // /audit verbose [on|off]  — toggle verbose live thinking messages
  if (args[0] === "verbose") {
    const sub = args[1]?.toLowerCase();
    if (sub === "on")  { gw.verboseAudit = true;  return { reply: "Verbose audit: ON" }; }
    if (sub === "off") { gw.verboseAudit = false; return { reply: "Verbose audit: OFF" }; }
    // toggle
    gw.verboseAudit = !gw.verboseAudit;
    return { reply: `Verbose audit: ${gw.verboseAudit ? "ON" : "OFF"}` };
  }

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
  /auth <provider> <api-key> — Store API key (anthropic, openai, gemini)
  /auth ollama local — Use local Ollama (http://localhost:11434)
  /auth ollama <url> — Use Ollama at a custom URL
  /auth status — Show connected providers
  /auth remove <provider> — Remove stored credentials
  /model — List all available models (fetched live from provider APIs)
  /model list <provider> — List models for one provider
  /model <provider/model> — Switch to a specific model

Tools:
  /tools — List all tools and their status
  /enable <tool> — Enable a builtin tool
  /disable <tool> — Disable a builtin tool
  /enable mcp:<server> — Enable all tools for an MCP server
  /disable mcp:<server> — Disable all tools for an MCP server
  /enable skill__<name> — Enable a dynamically created skill
  /disable skill__<name> — Disable a dynamically created skill

Permissions:
  /confirm — Show all pending approvals
  /confirm <id> — Approve a single pending action
  /confirm all <batchId> — Approve all actions in a batch at once
  /deny <id> — Reject a pending action
  /deny all <batchId> — Reject all actions in a batch at once

Info:
  /status — Show gateway state
  /audit [n] — Show last N audit events (default 10)
  /audit verbose — Toggle verbose mode (live thinking + tool messages)
  /audit verbose on — Enable verbose mode
  /audit verbose off — Disable verbose mode
  /skills — List prompt skills from ~/.safeclaw/prompt-skills/
  /help — Show this help

Builtin tools: browser, filesystem, shell, patch, memory
Shell tool includes background process management (exec_shell_bg, process_poll, process_write, process_kill).
Memory tool persists facts across sessions — auto-injected into every system prompt.
MCP tools: auto-discovered on /wake from ~/.claude/settings.json

Customisation:
  ~/.safeclaw/soul.md — Custom persona injected into system prompt on wake
  ~/.safeclaw/prompt-skills/*.md — Prompt-only skills (teach LLM CLI patterns)

Security: All tools disabled by default. Dangerous actions always require /confirm.`;
