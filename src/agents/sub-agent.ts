import type { Gateway } from "../core/gateway.js";
import type { LLMMessage, LLMToolSchema } from "../providers/types.js";
import { resolveProvider } from "../providers/resolver.js";
import { createSession, addUserMessage, addAssistantMessage, addToolResult } from "../agent/session.js";
import { buildToolSchemas, resolveToolCall, extractToolDetails } from "../agent/tool-schemas.js";
import { executeToolAction } from "../tools/executor.js";
import { SAFE_ACTIONS } from "../core/types.js";
import type { ActionType } from "../core/types.js";
import type { AgentRole } from "./roles.js";

/** Maximum LLM turns a sub-agent may take before we force a stop. */
const MAX_SUB_AGENT_TURNS = 8;

export interface SubAgentResult {
  text: string;
  /** Actions the sub-agent wanted to take but couldn't (needed /confirm). */
  pendingActions: string[];
}

/**
 * Run an ephemeral sub-agent for a single task.
 *
 * Sub-agents:
 * - Have their own ephemeral conversation (never touches gw.conversation)
 * - Execute SAFE actions immediately (read_file, list_dir, browse_web, etc.)
 * - SKIP dangerous actions — they describe what they would do in pendingActions
 * - Return the result as a string
 * - Are destroyed after the task
 */
export async function runSubAgent(
  gw: Gateway,
  role: AgentRole,
  systemPrompt: string,
  taskDescription: string,
  toolFilter?: (schema: LLMToolSchema) => boolean
): Promise<SubAgentResult> {
  const resolved = resolveProvider(gw.providerStore);
  if (!resolved) {
    return { text: "No LLM provider configured.", pendingActions: [] };
  }

  const { provider, model } = resolved;

  // Build tool schemas for this sub-agent
  const enabledTools = gw.tools.getEnabled();
  let toolSchemas = buildToolSchemas(enabledTools);

  // Reviewers and managers get no tools
  if (role === "reviewer" || role === "manager") {
    toolSchemas = [];
  }

  // Apply optional per-agent tool filter
  if (toolFilter) {
    toolSchemas = toolSchemas.filter(toolFilter);
  }

  const session = createSession();
  addUserMessage(session, taskDescription);

  const pendingActions: string[] = [];
  let turnCount = 0;

  while (turnCount < MAX_SUB_AGENT_TURNS) {
    turnCount++;

    const messages: LLMMessage[] = [
      { role: "system" as const, content: systemPrompt },
      ...session.messages,
    ];

    let response;
    try {
      response = await provider.chat(messages, toolSchemas, model);
    } catch (err) {
      return {
        text: `Sub-agent error: ${(err as Error).message}`,
        pendingActions,
      };
    }

    // No tool calls — we have the final answer
    if (!response.toolCalls || response.toolCalls.length === 0) {
      const text = response.text?.trim() || "(no output)";
      addAssistantMessage(session, text);
      return { text, pendingActions };
    }

    // Store assistant turn with tool calls
    addAssistantMessage(session, response.text, response.toolCalls);

    // Process each tool call
    for (const tc of response.toolCalls) {
      const mapping = resolveToolCall(tc.name);
      if (!mapping) {
        addToolResult(session, tc.id, tc.name, `Unknown tool: ${tc.name}`);
        continue;
      }

      const { toolName, action } = mapping;
      const details = extractToolDetails(tc.name, tc.input);

      // Check tool is enabled
      const toolDef = gw.tools.get(toolName);
      if (!toolDef || toolDef.status !== "enabled") {
        const errMsg = `Tool "${toolName}" is not enabled.`;
        addToolResult(session, tc.id, tc.name, errMsg);
        continue;
      }

      // Determine safety
      const isSafe = toolDef.isMcp || toolDef.isDynamic
        ? !toolDef.dangerous
        : SAFE_ACTIONS.includes(action as ActionType);

      if (isSafe) {
        try {
          const result = await executeToolAction(gw, toolName, action as ActionType, details);
          addToolResult(session, tc.id, tc.name, result.slice(0, 4_000));
        } catch (err) {
          addToolResult(session, tc.id, tc.name, `Error: ${(err as Error).message}`);
        }
      } else {
        // Dangerous action — skip but record it
        const note = `[Would execute] ${details.description}`;
        pendingActions.push(note);
        addToolResult(
          session,
          tc.id,
          tc.name,
          `Action requires owner confirmation: ${details.description}. Describe what you would do without actually doing it.`
        );
      }
    }
  }

  // Exceeded max turns — return whatever we have
  const lastAssistant = [...session.messages].reverse().find((m) => m.role === "assistant");
  return {
    text: lastAssistant?.content?.trim() || "(sub-agent reached turn limit)",
    pendingActions,
  };
}
