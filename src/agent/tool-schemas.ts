import type { ToolDefinition } from "../core/types.js";
import type { LLMToolSchema } from "../providers/types.js";

/**
 * Convert enabled SafeClaw tools into LLM tool_use schemas.
 * Only enabled tools are visible to the LLM — disabled tools don't exist.
 */
export function buildToolSchemas(enabledTools: ToolDefinition[]): LLMToolSchema[] {
  const schemas: LLMToolSchema[] = [];

  for (const tool of enabledTools) {
    // MCP tools emit their schema directly from the server's inputSchema
    if (tool.isMcp) {
      schemas.push({
        name: tool.name, // e.g. "mcp__my_server__search_web"
        description: tool.description,
        parameters: tool.mcpSchema ?? { type: "object", properties: {} },
      });
      continue;
    }

    // Builtin tools: static hand-crafted schemas
    switch (tool.name) {
      case "filesystem":
        schemas.push(
          {
            name: "read_file",
            description: "Read the contents of a file. The path is relative to the workspace directory.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path relative to workspace" },
              },
              required: ["path"],
            },
          },
          {
            name: "list_dir",
            description: "List the contents of a directory. The path is relative to the workspace directory. Use '.' or empty string for the workspace root.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "Directory path relative to workspace (default: '.')" },
              },
              required: [],
            },
          },
          {
            name: "write_file",
            description: "Write content to a file (creates or overwrites). The path is relative to the workspace directory. This action requires owner confirmation.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path relative to workspace" },
                content: { type: "string", description: "Content to write" },
              },
              required: ["path", "content"],
            },
          },
          {
            name: "delete_file",
            description: "Delete a file. The path is relative to the workspace directory. This action requires owner confirmation.",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string", description: "File path relative to workspace" },
              },
              required: ["path"],
            },
          }
        );
        break;

      case "shell":
        schemas.push({
          name: "exec_shell",
          description: "Execute a shell command. This action requires owner confirmation.",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string", description: "Shell command to execute" },
            },
            required: ["command"],
          },
        });
        break;

      case "browser":
        schemas.push({
          name: "browse_web",
          description: "Browse a URL or search the web.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "URL to visit or search query" },
            },
            required: ["query"],
          },
        });
        break;

      case "code_exec":
        schemas.push({
          name: "exec_code",
          description: "Execute a code snippet. This action requires owner confirmation.",
          parameters: {
            type: "object",
            properties: {
              code: { type: "string", description: "Code to execute" },
              language: { type: "string", description: "Programming language (default: javascript)" },
            },
            required: ["code"],
          },
        });
        break;

      case "network":
        schemas.push({
          name: "network_request",
          description: "Make an HTTP request. This action requires owner confirmation.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to request" },
              method: { type: "string", description: "HTTP method (default: GET)" },
            },
            required: ["url"],
          },
        });
        break;

      case "messaging":
        schemas.push({
          name: "send_message",
          description: "Send a message to a contact. This action requires owner confirmation.",
          parameters: {
            type: "object",
            properties: {
              contact: { type: "string", description: "Contact name or ID" },
              message: { type: "string", description: "Message to send" },
            },
            required: ["contact", "message"],
          },
        });
        break;
    }
  }

  return schemas;
}

/**
 * Map an LLM tool call name back to the SafeClaw tool/action pair.
 */
export function resolveToolCall(toolCallName: string): {
  toolName: string;
  action: string;
} | null {
  // MCP tools: name format is "mcp__<server>__<tool>"
  if (toolCallName.startsWith("mcp__")) {
    return { toolName: toolCallName, action: "mcp_call" };
  }

  // Builtin tool mappings
  const mapping: Record<string, { toolName: string; action: string }> = {
    read_file: { toolName: "filesystem", action: "read_file" },
    list_dir: { toolName: "filesystem", action: "list_dir" },
    write_file: { toolName: "filesystem", action: "write_file" },
    delete_file: { toolName: "filesystem", action: "delete_file" },
    exec_shell: { toolName: "shell", action: "exec_shell" },
    browse_web: { toolName: "browser", action: "browse_web" },
    exec_code: { toolName: "code_exec", action: "exec_code" },
    network_request: { toolName: "network", action: "network_request" },
    send_message: { toolName: "messaging", action: "send_message" },
  };

  return mapping[toolCallName] ?? null;
}

/**
 * Extract the target and content from LLM tool call input for the executor.
 */
export function extractToolDetails(
  toolCallName: string,
  input: Record<string, unknown>
): { target?: string; content?: string; description: string } {
  // MCP tools: serialize the full input as JSON into the target field
  if (toolCallName.startsWith("mcp__")) {
    return {
      target: JSON.stringify(input),
      description: `${toolCallName}: ${JSON.stringify(input).slice(0, 120)}`,
    };
  }

  switch (toolCallName) {
    case "read_file":
    case "delete_file":
      return {
        target: input.path as string,
        description: `${toolCallName}: ${input.path}`,
      };
    case "list_dir":
      return {
        target: (input.path as string) || ".",
        description: `list_dir: ${input.path || "."}`,
      };
    case "write_file":
      return {
        target: input.path as string,
        content: input.content as string,
        description: `write_file: ${input.path} (${((input.content as string) || "").length} chars)`,
      };
    case "exec_shell":
      return {
        target: input.command as string,
        description: `exec_shell: ${input.command}`,
      };
    case "browse_web":
      return {
        target: input.query as string,
        description: `browse_web: ${input.query}`,
      };
    case "exec_code":
      return {
        target: input.code as string,
        description: `exec_code: ${((input.code as string) || "").slice(0, 80)}`,
      };
    case "network_request":
      return {
        target: input.url as string,
        description: `network_request: ${input.method || "GET"} ${input.url}`,
      };
    case "send_message":
      return {
        target: `${input.contact}|${input.message}`,
        content: input.message as string,
        description: `send_message: to ${input.contact}`,
      };
    default:
      return { description: `${toolCallName}: ${JSON.stringify(input)}` };
  }
}
