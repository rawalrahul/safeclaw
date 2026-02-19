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
    const result = await runAgent(gw, enrichedText);
    if (looksLikeKeywordCommand(text) && shouldFallbackToKeyword(result)) {
      return keywordFallback(gw, text);
    }
    return result;
  }

  // ─── Keyword fallback (no LLM configured) ──────────────
  return keywordFallback(gw, text);
}

function looksLikeKeywordCommand(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return (
    lower.startsWith("read ") ||
    lower.startsWith("cat ") ||
    lower.startsWith("list ") ||
    lower.startsWith("ls ") ||
    lower.startsWith("dir ") ||
    lower.startsWith("search ") ||
    lower.startsWith("browse ") ||
    lower.startsWith("http://") ||
    lower.startsWith("https://") ||
    lower.startsWith("write ") ||
    lower.startsWith("save ") ||
    lower.startsWith("move ") ||
    lower.startsWith("rename ") ||
    lower.startsWith("delete ") ||
    lower.startsWith("del ") ||
    lower.startsWith("rm ")
  );
}

function shouldFallbackToKeyword(llmText: string): boolean {
  const text = llmText.toLowerCase();
  return (
    text.includes("\"request_capability\"") ||
    text.includes("skill proposal") ||
    text.includes("\"skill_name\"") ||
    text.includes("\"implementation_code\"")
  );
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
    const { arg } = parseFirstArg(text.slice(text.indexOf(" ") + 1));
    if (!arg) return `Usage: read <path>`;
    return tryInvokeTool(gw, "filesystem", "read_file", arg);
  }

  // ─── Pattern: List Directory (safe action) ────────
  if (lower.startsWith("list ") || lower.startsWith("ls ") || lower.startsWith("dir ")) {
    const { arg } = parseFirstArg(text.slice(text.indexOf(" ") + 1));
    const path = arg || ".";
    return tryInvokeTool(gw, "filesystem", "list_dir", path);
  }

  // ─── Pattern: File Write (dangerous) ──────────────
  if (lower.startsWith("write ") || lower.startsWith("save ")) {
    const rest = text.slice(text.indexOf(" ") + 1);
    const parsed = parseFirstArg(rest);
    if (!parsed.arg || !parsed.rest) {
      return `Usage: write <path> <content>`;
    }
    return tryInvokeToolWithContent(gw, "filesystem", "write_file", parsed.arg, parsed.rest);
  }

  // â”€â”€â”€ Pattern: File Delete (dangerous) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (lower.startsWith("delete ") || lower.startsWith("del ") || lower.startsWith("rm ")) {
    const { arg } = parseFirstArg(text.slice(text.indexOf(" ") + 1));
    if (!arg) {
      return `Usage: delete <path>`;
    }
    return tryInvokeTool(gw, "filesystem", "delete_file", arg);
  }

  // â”€â”€â”€ Pattern: File Move/Rename (dangerous) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (lower.startsWith("move ") || lower.startsWith("rename ")) {
    const rest = text.slice(text.indexOf(" ") + 1).trim();
    const arrowIdx = rest.indexOf(" -> ");
    if (arrowIdx !== -1) {
      const from = stripQuotes(rest.slice(0, arrowIdx).trim());
      const to = stripQuotes(rest.slice(arrowIdx + 4).trim());
      if (!from || !to) return `Usage: move <from> <to>`;
      return tryInvokeToolWithContent(gw, "filesystem", "move_file", from, to);
    }
    const parsedFrom = parseFirstArg(rest);
    if (!parsedFrom.arg || !parsedFrom.rest) {
      return `Usage: move <from> <to>`;
    }
    const parsedTo = parseFirstArg(parsedFrom.rest);
    if (!parsedTo.arg) return `Usage: move <from> <to>`;
    return tryInvokeToolWithContent(gw, "filesystem", "move_file", parsedFrom.arg, parsedTo.arg);
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
    `  "move <from> <to>" — move/rename a file (needs /confirm)\n` +
    `  "delete <path>" — delete a file (needs /confirm)\n` +
    `  "run <command>" — shell (needs /confirm)\n` +
    `  "fetch <url>" — network (needs /confirm)\n` +
    `  "send <contact> <msg>" — messaging (needs /confirm)`
  );
}

function parseFirstArg(input: string): { arg: string | null; rest: string } {
  let s = input.trim();
  if (!s) return { arg: null, rest: "" };

  const firstChar = s[0];
  if (firstChar === "\"" || firstChar === "'") {
    const quote = firstChar;
    let idx = 1;
    let value = "";
    while (idx < s.length) {
      const ch = s[idx];
      if (ch === quote) {
        const rest = s.slice(idx + 1).trimStart();
        return { arg: value, rest };
      }
      value += ch;
      idx += 1;
    }
    return { arg: value, rest: "" };
  }

  const spaceIdx = s.indexOf(" ");
  if (spaceIdx === -1) return { arg: s, rest: "" };
  return { arg: s.slice(0, spaceIdx), rest: s.slice(spaceIdx + 1).trimStart() };
}

function stripQuotes(value: string): string {
  const v = value.trim();
  if ((v.startsWith("\"") && v.endsWith("\"")) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
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
