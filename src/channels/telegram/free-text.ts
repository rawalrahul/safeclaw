import type { Gateway } from "../../core/gateway.js";
import type { ToolName, ActionType } from "../../core/types.js";
import { SAFE_ACTIONS } from "../../core/types.js";
import { runAgent } from "../../agent/runner.js";
import { executeToolAction } from "../../tools/executor.js";
import { fetchUrl } from "../../tools/browser.js";

/**
 * Handle free-text messages when the gateway is awake.
 *
 * If an LLM provider is configured, routes through the agent (which uses
 * real tool_use to pick tools). Otherwise falls back to keyword patterns.
 *
 * URL auto-enrichment: if the browser tool is enabled and the message contains
 * one or more https?:// URLs, we fetch them proactively and prepend their
 * content to the message so the LLM sees the page without needing a tool call.
 */
export async function handleFreeText(
  gw: Gateway,
  text: string
): Promise<string> {
  // If LLM provider is configured, use the agent
  if (gw.providerStore.getActiveProvider()) {
    const enrichedText = await enrichWithUrls(gw, text);
    return runAgent(gw, enrichedText);
  }

  // ─── Keyword fallback (no LLM configured) ──────────────
  return keywordFallback(gw, text);
}

/** Max chars of URL-fetched content to prepend per URL. */
const URL_ENRICH_MAX_CHARS = 6_000;

/**
 * Detect URLs in the message. If the browser tool is enabled, fetch each URL
 * and prepend the extracted text so the LLM sees it as inline context.
 */
async function enrichWithUrls(gw: Gateway, text: string): Promise<string> {
  if (!gw.tools.isEnabled("browser")) return text;

  const urlRegex = /https?:\/\/[^\s<>"'\]]+/gi;
  const urls = [...new Set(text.match(urlRegex) ?? [])];
  if (urls.length === 0) return text;

  const snippets: string[] = [];
  for (const url of urls.slice(0, 3)) { // limit to 3 URLs per message
    try {
      const fetched = await fetchUrl(url);
      const content = fetched.result.slice(0, URL_ENRICH_MAX_CHARS);
      snippets.push(`[Auto-fetched: ${url}]\n${content}`);
    } catch {
      // Silently skip failed fetches — LLM can still call browse_web if needed
    }
  }

  if (snippets.length === 0) return text;

  return `${text}\n\n---\nURL Context (auto-fetched):\n${snippets.join("\n\n---\n")}`;
}

/**
 * Keyword pattern matching fallback for when no LLM is configured.
 */
async function keywordFallback(gw: Gateway, text: string): Promise<string> {
  const lower = text.toLowerCase().trim();

  // ─── Pattern: File Read (safe action) ─────────────
  if (lower.startsWith("read ") || lower.startsWith("cat ")) {
    return tryInvokeTool(gw, "filesystem", "read_file", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: List Directory (safe action) ────────
  if (lower.startsWith("list ") || lower.startsWith("ls ") || lower.startsWith("dir ")) {
    return tryInvokeTool(gw, "filesystem", "list_dir", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: File Write (dangerous) ──────────────
  if (lower.startsWith("write ") || lower.startsWith("save ")) {
    const rest = text.slice(text.indexOf(" ") + 1);
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx === -1) {
      return `Usage: write <path> <content>`;
    }
    const path = rest.slice(0, spaceIdx);
    const content = rest.slice(spaceIdx + 1);
    return tryInvokeToolWithContent(gw, "filesystem", "write_file", path, content);
  }

  // ─── Pattern: Browser ─────────────────────────────
  if (lower.startsWith("search ") || lower.startsWith("browse ")) {
    return tryInvokeTool(gw, "browser", "browse_web", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: Shell Execute (dangerous) ───────────
  if (lower.startsWith("run ") || lower.startsWith("exec ")) {
    return tryInvokeTool(gw, "shell", "exec_shell", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: Code Execution (dangerous) ────────────
  if (lower.startsWith("eval ") || lower.startsWith("code ") || lower.startsWith("execute ")) {
    return tryInvokeTool(gw, "code_exec", "exec_code", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: Network Request (dangerous) ──────────
  if (lower.startsWith("fetch ") || lower.startsWith("curl ") || lower.startsWith("request ") || lower.startsWith("http ")) {
    return tryInvokeTool(gw, "network", "network_request", text.slice(text.indexOf(" ") + 1));
  }

  // ─── Pattern: Send Message (dangerous) ──────────────
  if (lower.startsWith("send ") || lower.startsWith("message ") || lower.startsWith("msg ")) {
    const rest = text.slice(text.indexOf(" ") + 1);
    const spaceIdx = rest.indexOf(" ");
    if (spaceIdx === -1) {
      return `Usage: send <contact> <message>`;
    }
    const contact = rest.slice(0, spaceIdx);
    const message = rest.slice(spaceIdx + 1);
    return tryInvokeToolWithContent(gw, "messaging", "send_message", `${contact}|${message}`, message);
  }

  // ─── No tool match ────────────────────────────────
  return (
    `No LLM provider configured — using keyword mode.\n\n` +
    `Set up a provider: /auth anthropic <api-key>\n\n` +
    `Or use keywords:\n` +
    `  "read <path>" — read a file\n` +
    `  "list <path>" — list directory\n` +
    `  "write <path> <content>" — write a file (needs /confirm)\n` +
    `  "run <command>" — shell (needs /confirm)\n` +
    `  "fetch <url>" — network (needs /confirm)\n` +
    `  "send <contact> <msg>" — messaging (needs /confirm)`
  );
}

async function tryInvokeTool(
  gw: Gateway,
  toolName: ToolName,
  action: ActionType,
  target: string
): Promise<string> {
  return tryInvokeToolWithContent(gw, toolName, action, target);
}

async function tryInvokeToolWithContent(
  gw: Gateway,
  toolName: ToolName,
  action: ActionType,
  target: string,
  content?: string
): Promise<string> {
  if (!gw.tools.isEnabled(toolName)) {
    return (
      `The "${toolName}" tool is DISABLED.\n` +
      `Use /enable ${toolName} to activate it first.`
    );
  }

  // Safe actions execute immediately
  if (SAFE_ACTIONS.includes(action)) {
    await gw.audit.log("action_executed", { tool: toolName, action, target });
    try {
      return await executeToolAction(gw, toolName, action, {
        description: `${action}: ${target}`,
        target,
        content,
      });
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
  }

  // Dangerous actions require /confirm
  const req = gw.approvals.create(toolName, action, `${action}: ${target}`, {
    target,
    content,
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
