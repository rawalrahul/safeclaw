import type { Gateway } from "../core/gateway.js";
import type { ActionType } from "../core/types.js";
import { fsReadFile, fsListDir, fsWriteFile, fsDeleteFile, fsMoveFile, resolveSafePath } from "./filesystem.js";
import { fetchUrl } from "./browser.js";
import { execShell } from "./shell.js";
import { applyPatch } from "./patch.js";
import { memoryRead, memoryWrite, memoryList, memoryDelete } from "./memory.js";
import { parseMcpLLMName } from "../mcp/manager.js";
import { SecretGuard, checkShellCommand, redactEnvVars } from "../security/secret-guard.js";

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
  const guard = new SecretGuard(gw.config.storageDir);

  try {
    switch (toolName) {
      case "filesystem": {
        const target = details.target || "";
        // SecretGuard: check path before any filesystem operation
        if (action === "read_file" || action === "write_file" || action === "delete_file") {
          try {
            const absPath = await resolveSafePath(workspaceDir, target);
            const denied = guard.checkPath(absPath);
            if (denied) return denied;
          } catch {
            // resolveSafePath may throw for invalid paths — let the actual op handle it
          }
        }
        if (action === "move_file") {
          try {
            const absFrom = await resolveSafePath(workspaceDir, target);
            const deniedFrom = guard.checkPath(absFrom);
            if (deniedFrom) return deniedFrom;
            if (details.content) {
              const absTo = await resolveSafePath(workspaceDir, details.content);
              const deniedTo = guard.checkPath(absTo);
              if (deniedTo) return deniedTo;
            }
          } catch {
            // let the actual op handle it
          }
        }
        switch (action) {
          case "read_file":
            return (await fsReadFile(workspaceDir, target)).result;
          case "list_dir":
            return (await fsListDir(workspaceDir, target)).result;
          case "write_file":
            return (await fsWriteFile(workspaceDir, target, details.content || "")).result;
          case "delete_file":
            return (await fsDeleteFile(workspaceDir, target)).result;
          case "move_file":
            if (!details.content) return "Error: move_file requires a destination path.";
            return (await fsMoveFile(workspaceDir, target, details.content)).result;
          default:
            return `Unknown filesystem action: ${action}`;
        }
      }

      case "browser": {
        const url = details.target || details.description;
        await gw.progressCallback?.(`🔍 Fetching: ${url}`);
        return (await fetchUrl(url)).result;
      }

      case "shell": {
        switch (action) {
          case "exec_shell": {
            const cmd = details.target || details.description;
            // SecretGuard: block commands that try to read protected files
            const shellDenied = checkShellCommand(cmd);
            if (shellDenied) return shellDenied;
            await gw.progressCallback?.(`⚙️ Running: ${cmd}`);
            const rawOutput = await execShell(cmd, workspaceDir);
            return redactEnvVars(rawOutput);
          }
          case "exec_shell_bg": {
            const bgCmd = details.target || details.description;
            await gw.progressCallback?.(`⚙️ Starting background process: ${bgCmd}`);
            const sessionId = gw.processRegistry.spawn(bgCmd, workspaceDir);
            return `Background process started.\nSession ID: ${sessionId}\n\nUse process_poll with session_id="${sessionId}" to check output.`;
          }
          case "process_poll":
            return gw.processRegistry.poll(details.target || "");
          case "process_write":
            return gw.processRegistry.write(details.target || "", details.content || "");
          case "process_kill":
            return gw.processRegistry.kill(details.target || "");
          case "process_list":
            return gw.processRegistry.list();
          default:
            return `Unknown shell action: ${action}`;
        }
      }

      case "memory": {
        const storageDir = gw.config.storageDir;
        switch (action) {
          case "memory_read":
            return await memoryRead(storageDir, details.target || "");
          case "memory_write":
            return await memoryWrite(storageDir, details.target || "", details.content || "");
          case "memory_list":
            return await memoryList(storageDir);
          case "memory_delete":
            return await memoryDelete(storageDir, details.target || "");
          default:
            return `Unknown memory action: ${action}`;
        }
      }

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
