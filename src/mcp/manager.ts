import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDefinition } from "../core/types.js";
import type { McpServerConfig } from "./config.js";

// ─── Name helpers ─────────────────────────────────────────────

/**
 * Convert a server name + MCP tool name to the LLM-facing name.
 * Format: mcp__<server>__<tool>  (double underscore, no colons, safe for LLM APIs)
 * Non-alphanumeric characters in either segment are replaced with underscores.
 */
export function toLLMName(serverName: string, mcpToolName: string): string {
  const safeServer = serverName.replace(/[^a-zA-Z0-9]/g, "_");
  const safeTool = mcpToolName.replace(/[^a-zA-Z0-9]/g, "_");
  return `mcp__${safeServer}__${safeTool}`;
}

/**
 * Parse an LLM-facing tool name back into its server and original tool name parts.
 * Returns null if the name is not an MCP tool name.
 */
export function parseMcpLLMName(
  llmName: string
): { serverName: string; toolName: string } | null {
  if (!llmName.startsWith("mcp__")) return null;
  const rest = llmName.slice(5); // after "mcp__"
  const idx = rest.indexOf("__");
  if (idx === -1) return null;
  return { serverName: rest.slice(0, idx), toolName: rest.slice(idx + 2) };
}

// ─── Danger heuristic ─────────────────────────────────────────

const SAFE_KEYWORDS = ["read", "get", "list", "search", "fetch", "view", "show", "find", "describe", "check"];
const DANGEROUS_KEYWORDS = ["create", "write", "delete", "send", "post", "put", "update", "remove", "modify", "execute", "run", "deploy", "push"];

function inferDangerous(toolName: string, description: string): boolean {
  const text = `${toolName} ${description}`.toLowerCase();
  if (SAFE_KEYWORDS.some((k) => text.includes(k))) return false;
  if (DANGEROUS_KEYWORDS.some((k) => text.includes(k))) return true;
  return true; // default to dangerous
}

// ─── MCP content serializer ───────────────────────────────────

function serializeContent(content: Array<{ type: string; text?: string }>): string {
  if (!content || content.length === 0) return "(empty result)";
  return content
    .map((item) => (item.type === "text" ? (item.text ?? "") : `[${item.type} content]`))
    .filter(Boolean)
    .join("\n");
}

// ─── McpManager ───────────────────────────────────────────────

export class McpManager {
  private clients: Map<string, Client> = new Map();
  /** Maps LLM tool name → original MCP tool name, for call dispatch */
  private toolNameMap: Map<string, string> = new Map();

  /**
   * Connect to a single MCP server and return the discovered tool definitions.
   * Skips gracefully on auth errors or connection failures.
   */
  async connectServer(name: string, config: McpServerConfig): Promise<ToolDefinition[]> {
    try {
      const client = new Client(
        { name: "safeclaw", version: "0.1.0" },
        { capabilities: {} }
      );

      if (!("command" in config)) {
        console.warn(
          `[mcp] Server "${name}" uses HTTP/SSE transport — not yet supported, skipping.`
        );
        return [];
      }

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: {
          ...(process.env as Record<string, string>),
          ...(config.env ?? {}),
        },
      });

      await client.connect(transport);
      this.clients.set(name, client);

      const toolsResult = await client.listTools();
      const defs: ToolDefinition[] = [];

      for (const tool of toolsResult.tools) {
        const llmName = toLLMName(name, tool.name);
        const dangerous = inferDangerous(tool.name, tool.description ?? "");

        this.toolNameMap.set(llmName, tool.name);

        defs.push({
          name: llmName,
          description: tool.description ?? tool.name,
          dangerous,
          status: "disabled",
          isMcp: true,
          mcpServer: name,
          mcpToolName: tool.name,
          mcpSchema: tool.inputSchema as Record<string, unknown>,
        });
      }

      console.log(`[mcp] Connected to "${name}", discovered ${defs.length} tool(s).`);
      return defs;
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      if (/401|403|Unauthorized|Forbidden/i.test(msg)) {
        console.warn(`[mcp] Server "${name}" authentication failed (${msg}) — skipping.`);
      } else {
        console.warn(`[mcp] Failed to connect to "${name}": ${msg}`);
      }
      return [];
    }
  }

  /**
   * Call a tool on a connected MCP server.
   * @param serverName The server name as stored in the registry (may be sanitized).
   * @param mcpToolName The original (unsanitized) MCP tool name from the ToolDefinition.
   * @param args The arguments object to pass to the tool.
   */
  async callTool(
    serverName: string,
    mcpToolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const client = this.clients.get(serverName);
    if (!client) return `[mcp] Server "${serverName}" is not connected.`;

    try {
      const result = await client.callTool({ name: mcpToolName, arguments: args });
      const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
      return serializeContent(content ?? []);
    } catch (err) {
      return `[mcp] Tool call failed: ${(err as Error).message}`;
    }
  }

  /** Disconnect all connected servers and clear state. */
  async disconnectAll(): Promise<void> {
    for (const [name, client] of this.clients) {
      try {
        await client.close();
        console.log(`[mcp] Disconnected from "${name}".`);
      } catch {
        // Ignore errors during disconnect
      }
    }
    this.clients.clear();
    this.toolNameMap.clear();
  }

  isConnected(serverName: string): boolean {
    return this.clients.has(serverName);
  }
}
