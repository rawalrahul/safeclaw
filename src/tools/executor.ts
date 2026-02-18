import type { Gateway } from "../core/gateway.js";
import type { ActionType } from "../core/types.js";
import { fsReadFile, fsListDir, fsWriteFile, fsDeleteFile } from "./filesystem.js";
import { simulateBrowser } from "./browser.js";
import { simulateShell } from "./shell.js";
import { simulateSendMessage } from "./messaging.js";
import { simulateCodeExec } from "./code_exec.js";
import { simulateNetworkRequest } from "./network.js";
import { parseMcpLLMName } from "../mcp/manager.js";

/**
 * Execute a tool action. Filesystem tools are real; others remain simulated stubs.
 * MCP tool calls are dispatched through McpManager.
 */
export async function executeToolAction(
  gw: Gateway,
  toolName: string,
  action: ActionType | string,
  details: { description: string; target?: string; content?: string }
): Promise<string> {
  const workspaceDir = gw.config.workspaceDir;

  try {
    switch (toolName) {
      case "filesystem": {
        const target = details.target || "";
        switch (action) {
          case "read_file":
            return (await fsReadFile(workspaceDir, target)).result;
          case "list_dir":
            return (await fsListDir(workspaceDir, target)).result;
          case "write_file":
            return (await fsWriteFile(workspaceDir, target, details.content || "")).result;
          case "delete_file":
            return (await fsDeleteFile(workspaceDir, target)).result;
          default:
            return `Unknown filesystem action: ${action}`;
        }
      }

      // ─── Still simulated ───────────────────────────────────
      case "browser":
        return simulateBrowser(details.target || details.description).result;
      case "shell":
        return simulateShell(details.target || details.description).result;
      case "messaging": {
        const msgTarget = details.target || "";
        const [contact, ...msgParts] = msgTarget.split("|");
        return simulateSendMessage(contact || "unknown", msgParts.join("|") || details.content || "").result;
      }
      case "code_exec":
        return simulateCodeExec(details.target || details.description).result;
      case "network":
        return simulateNetworkRequest(details.target || details.description).result;

      default: {
        // ─── MCP tool call ─────────────────────────────────
        if (action === "mcp_call") {
          const parsed = parseMcpLLMName(toolName);
          if (!parsed) {
            return `[mcp] Cannot parse MCP tool name: "${toolName}"`;
          }
          let args: Record<string, unknown> = {};
          try {
            args = details.target ? (JSON.parse(details.target) as Record<string, unknown>) : {};
          } catch {
            args = {};
          }
          return await gw.mcpManager.callTool(parsed.serverName, parsed.toolName, args);
        }

        return `[Simulated] ${toolName}/${action}: ${details.description}`;
      }
    }
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}
