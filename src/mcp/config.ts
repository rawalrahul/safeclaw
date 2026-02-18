import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type McpServerConfig =
  | { type?: "stdio"; command: string; args?: string[]; env?: Record<string, string> }
  | { type: "sse" | "http" | "streamable-http"; url: string; headers?: Record<string, string> };

export type McpServersConfig = Record<string, McpServerConfig>;

/** Resolve ${ENV_VAR} placeholders using the current process environment. */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? "");
}

function resolveConfigEnv(config: McpServerConfig): McpServerConfig {
  if ("url" in config) {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.headers ?? {})) {
      headers[k] = resolveEnvVars(v);
    }
    return { ...config, url: resolveEnvVars(config.url), headers };
  } else {
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(config.env ?? {})) {
      env[k] = resolveEnvVars(v);
    }
    return { ...config, env };
  }
}

/**
 * Read MCP server configs from Claude Code settings or Claude Desktop config.
 * Returns an empty object if neither file has servers defined.
 */
export function readMcpServersConfig(): McpServersConfig {
  // Primary: ~/.claude/settings.json (Claude Code)
  const claudeCodePath = path.join(os.homedir(), ".claude", "settings.json");

  // Fallback: %APPDATA%/Claude/claude_desktop_config.json (Windows)
  //           ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
  const appData =
    process.env.APPDATA ?? path.join(os.homedir(), "Library", "Application Support");
  const claudeDesktopPath = path.join(appData, "Claude", "claude_desktop_config.json");

  for (const filePath of [claudeCodePath, claudeDesktopPath]) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      const servers = parsed.mcpServers;
      if (servers && typeof servers === "object" && Object.keys(servers).length > 0) {
        const result: McpServersConfig = {};
        for (const [name, cfg] of Object.entries(servers)) {
          result[name] = resolveConfigEnv(cfg as McpServerConfig);
        }
        return result;
      }
    } catch {
      // File not found or parse error — try next candidate
    }
  }

  return {};
}
