import type { Gateway } from "../core/gateway.js";
import type { ActionType } from "../core/types.js";
import { fsReadFile, fsListDir, fsWriteFile, fsDeleteFile } from "./filesystem.js";
import { fetchUrl } from "./browser.js";
import { execShell } from "./shell.js";
import { applyPatch } from "./patch.js";
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

      case "browser":
        return (await fetchUrl(details.target || details.description)).result;

      case "shell":
        return await execShell(details.target || details.description, workspaceDir);

      case "patch":
        return await applyPatch(details.target || details.description, workspaceDir);

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

        // ─── Dynamic skill call ────────────────────────────
        if (action === "skill_call") {
          const skillName = toolName.replace(/^skill__/, "");
          const skill = gw.skillsManager.get(skillName);
          if (!skill) return `Skill "${skillName}" not found.`;

          let params: Record<string, unknown> = {};
          try {
            params = details.target ? (JSON.parse(details.target) as Record<string, unknown>) : {};
          } catch {
            params = {};
          }
          return await skill.execute(params);
        }

        // ─── Skill install (after /confirm on a proposal) ──
        if (action === "skill_install") {
          const skillName = details.target;
          const code = details.content;
          if (!skillName || !code) return "Skill install failed: missing name or code.";

          const skill = await gw.skillsManager.install(skillName, code);
          // Auto-enable: user already approved the install which is the dangerous step
          gw.tools.registerDynamic(skill, true);

          await gw.audit.log("skill_installed", { skillName: skill.name });
          return (
            `Skill "${skill.name}" has been installed and is now active.\n` +
            `You can use it as tool "skill__${skill.name}" to complete the task.`
          );
        }

        return `[Simulated] ${toolName}/${action}: ${details.description}`;
      }
    }
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}
