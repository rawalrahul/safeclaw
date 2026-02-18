import type { ToolDefinition } from "../core/types.js";
import type { LLMToolSchema } from "../providers/types.js";

// ─── Meta-tool: always injected regardless of enabled tools ──

/**
 * The request_capability tool is always available to the LLM.
 * The agent calls it when it realises it cannot complete a task with current tools.
 * It proposes a new skill (name + implementation code) for the owner to approve.
 */
export const REQUEST_CAPABILITY_SCHEMA: LLMToolSchema = {
  name: "request_capability",
  description:
    "Call this when you cannot complete the user's request because you lack a required skill " +
    "(e.g. PDF generation, spreadsheet creation, image processing, web scraping). " +
    "Provide a complete, working ES module JavaScript implementation. " +
    "The owner will review the code and approve or deny before it is installed.",
  parameters: {
    type: "object",
    properties: {
      skill_name: {
        type: "string",
        description:
          "Short snake_case identifier for the new skill, e.g. pdf_create, ppt_generate, image_resize",
      },
      skill_description: {
        type: "string",
        description: "One-sentence description shown to the owner in the approval prompt",
      },
      reason: {
        type: "string",
        description: "Why this skill is needed to complete the current user request",
      },
      dangerous: {
        type: "boolean",
        description:
          "true if the skill writes files, makes network calls, spawns processes, or has side effects",
      },
      parameters_schema: {
        type: "object",
        description: "JSON Schema object describing the skill's input parameters",
      },
      implementation_code: {
        type: "string",
        description:
          "Complete ES module JavaScript (.mjs). Must export:\n" +
          "  export const skill = {\n" +
          "    name: string,\n" +
          "    description: string,\n" +
          "    dangerous: boolean,\n" +
          "    parameters: { type: 'object', properties: {...}, required: [...] },\n" +
          "    async execute(params) { ... return string; }\n" +
          "  };\n" +
          "Use Node.js built-ins (fs, path, child_process) or packages already installed in the project. " +
          "The code runs in the same Node.js process as SafeClaw.",
      },
    },
    required: [
      "skill_name",
      "skill_description",
      "reason",
      "dangerous",
      "parameters_schema",
      "implementation_code",
    ],
  },
};

/**
 * Convert enabled SafeClaw tools into LLM tool_use schemas.
 * Only enabled tools are visible to the LLM — disabled tools don't exist.
 */
export function buildToolSchemas(enabledTools: ToolDefinition[]): LLMToolSchema[] {
  const schemas: LLMToolSchema[] = [];

  for (const tool of enabledTools) {
    // Dynamic skills: use stored parameters schema
    if (tool.isDynamic && tool.skillName) {
      schemas.push({
        name: `skill__${tool.skillName}`,
        description: tool.description,
        parameters: tool.skillParameters ?? { type: "object", properties: {} },
      });
      continue;
    }

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

      case "browser":
        schemas.push({
          name: "browse_web",
          description: "Fetch a URL or search the web. Returns clean readable text using Firefox Reader Mode. For plain queries (not URLs), searches DuckDuckGo.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Full URL (https://...) or plain search query" },
            },
            required: ["query"],
          },
        });
        break;

      case "shell":
        schemas.push(
          {
            name: "exec_shell",
            description: "Execute a shell command in the workspace directory. Returns stdout and stderr. Requires owner confirmation.",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string", description: "Shell command to execute" },
              },
              required: ["command"],
            },
          },
          {
            name: "exec_shell_bg",
            description: "Spawn a long-running shell command in the background. Returns a session_id immediately without waiting. Use process_poll to check output later. Requires owner confirmation.",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string", description: "Shell command to run in the background" },
              },
              required: ["command"],
            },
          },
          {
            name: "process_poll",
            description: "Read all accumulated output from a background process. Does not consume the buffer — you can poll again to see new output.",
            parameters: {
              type: "object",
              properties: {
                session_id: { type: "string", description: "Session ID returned by exec_shell_bg" },
              },
              required: ["session_id"],
            },
          },
          {
            name: "process_write",
            description: "Write text to the stdin of a running background process (e.g. answer a prompt). Requires owner confirmation.",
            parameters: {
              type: "object",
              properties: {
                session_id: { type: "string", description: "Session ID returned by exec_shell_bg" },
                input: { type: "string", description: "Text to write to stdin (newline appended automatically)" },
              },
              required: ["session_id", "input"],
            },
          },
          {
            name: "process_kill",
            description: "Send SIGTERM to a background process to stop it. Requires owner confirmation.",
            parameters: {
              type: "object",
              properties: {
                session_id: { type: "string", description: "Session ID returned by exec_shell_bg" },
              },
              required: ["session_id"],
            },
          },
          {
            name: "process_list",
            description: "List all active background process sessions and their status.",
            parameters: {
              type: "object",
              properties: {},
              required: [],
            },
          }
        );
        break;

      case "memory":
        schemas.push(
          {
            name: "memory_write",
            description:
              "Store a fact in persistent memory. Use a short descriptive key (e.g. 'user_name', 'preferred_language', 'project_path'). " +
              "Memory persists across sessions and is automatically included in your context.",
            parameters: {
              type: "object",
              properties: {
                key: { type: "string", description: "Short snake_case identifier for the fact" },
                value: { type: "string", description: "The value to remember" },
              },
              required: ["key", "value"],
            },
          },
          {
            name: "memory_read",
            description: "Read a specific stored memory by its key.",
            parameters: {
              type: "object",
              properties: {
                key: { type: "string", description: "The memory key to look up" },
              },
              required: ["key"],
            },
          },
          {
            name: "memory_list",
            description: "List all stored memories with their values.",
            parameters: {
              type: "object",
              properties: {},
              required: [],
            },
          },
          {
            name: "memory_delete",
            description: "Delete a stored memory by key. Requires owner confirmation.",
            parameters: {
              type: "object",
              properties: {
                key: { type: "string", description: "The memory key to delete" },
              },
              required: ["key"],
            },
          }
        );
        break;

      case "patch":
        schemas.push({
          name: "apply_patch",
          description:
            "Apply a code patch to workspace files. Supports Add File, Update File (context diff), Delete File, Move to. " +
            "Format: *** Begin Patch\\n*** Add File: foo.ts\\n<content>\\n*** Update File: bar.ts\\n-old\\n+new\\n*** End Patch. " +
            "Requires owner confirmation.",
          parameters: {
            type: "object",
            properties: {
              patch: { type: "string", description: "Full patch text including *** Begin Patch and *** End Patch markers" },
            },
            required: ["patch"],
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
  // Dynamic skills: name format is "skill__<name>"
  if (toolCallName.startsWith("skill__")) {
    return { toolName: toolCallName, action: "skill_call" };
  }

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
    browse_web: { toolName: "browser", action: "browse_web" },
    memory_write: { toolName: "memory", action: "memory_write" },
    memory_read: { toolName: "memory", action: "memory_read" },
    memory_list: { toolName: "memory", action: "memory_list" },
    memory_delete: { toolName: "memory", action: "memory_delete" },
    exec_shell: { toolName: "shell", action: "exec_shell" },
    exec_shell_bg: { toolName: "shell", action: "exec_shell_bg" },
    process_poll: { toolName: "shell", action: "process_poll" },
    process_write: { toolName: "shell", action: "process_write" },
    process_kill: { toolName: "shell", action: "process_kill" },
    process_list: { toolName: "shell", action: "process_list" },
    apply_patch: { toolName: "patch", action: "apply_patch" },
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
  // Dynamic skills: serialize the full input as JSON
  if (toolCallName.startsWith("skill__")) {
    return {
      target: JSON.stringify(input),
      description: `${toolCallName}: ${JSON.stringify(input).slice(0, 120)}`,
    };
  }

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
    case "browse_web":
      return {
        target: input.query as string,
        description: `browse_web: ${input.query}`,
      };
    case "exec_shell":
      return {
        target: input.command as string,
        description: `exec_shell: ${input.command}`,
      };
    case "exec_shell_bg":
      return {
        target: input.command as string,
        description: `exec_shell_bg: ${input.command}`,
      };
    case "process_poll":
      return {
        target: input.session_id as string,
        description: `process_poll: session ${input.session_id}`,
      };
    case "process_write":
      return {
        target: input.session_id as string,
        content: input.input as string,
        description: `process_write: session ${input.session_id}`,
      };
    case "process_kill":
      return {
        target: input.session_id as string,
        description: `process_kill: session ${input.session_id}`,
      };
    case "process_list":
      return {
        description: "process_list",
      };
    case "memory_write":
      return {
        target: input.key as string,
        content: input.value as string,
        description: `memory_write: ${input.key} = ${String(input.value).slice(0, 80)}`,
      };
    case "memory_read":
      return {
        target: input.key as string,
        description: `memory_read: ${input.key}`,
      };
    case "memory_list":
      return { description: "memory_list" };
    case "memory_delete":
      return {
        target: input.key as string,
        description: `memory_delete: ${input.key}`,
      };
    case "apply_patch":
      return {
        target: input.patch as string,
        description: `apply_patch (${((input.patch as string) || "").split("\n").length} lines)`,
      };
    default:
      return { description: `${toolCallName}: ${JSON.stringify(input)}` };
  }
}
