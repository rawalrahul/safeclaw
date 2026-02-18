import type { Gateway } from "../core/gateway.js";
import type { ActionType, ToolName } from "../core/types.js";
import { fsReadFile, fsListDir, fsWriteFile, fsDeleteFile } from "./filesystem.js";
import { simulateBrowser } from "./browser.js";
import { simulateShell } from "./shell.js";
import { simulateSendMessage } from "./messaging.js";
import { simulateCodeExec } from "./code_exec.js";
import { simulateNetworkRequest } from "./network.js";

/**
 * Execute a tool action. Filesystem tools are real; others remain simulated stubs
 * until Phase 4 replaces them.
 */
export async function executeToolAction(
  gw: Gateway,
  toolName: ToolName | string,
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

      // ─── Still simulated (Phase 4) ─────────────────────
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
      default:
        return `[Simulated] ${toolName}/${action}: ${details.description}`;
    }
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}
