import type { LLMMessage } from "../providers/types.js";

export interface ConversationSession {
  messages: LLMMessage[];
  /** Pending tool call IDs waiting for confirmation */
  pendingToolCalls: Map<string, PendingToolCall>;
}

export interface PendingToolCall {
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export function createSession(): ConversationSession {
  return {
    messages: [],
    pendingToolCalls: new Map(),
  };
}

export function addUserMessage(session: ConversationSession, text: string): void {
  session.messages.push({ role: "user", content: text });
}

export function addAssistantMessage(
  session: ConversationSession,
  text: string | null,
  toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>
): void {
  session.messages.push({
    role: "assistant",
    content: text ?? "",
    toolCalls: toolCalls?.length ? toolCalls : undefined,
  });
}

export function addToolResult(
  session: ConversationSession,
  toolCallId: string,
  toolName: string,
  result: string
): void {
  session.messages.push({
    role: "tool_result",
    content: result,
    toolCallId,
    toolName,
  });
}

const MAX_HISTORY = 50;

export function trimHistory(session: ConversationSession): void {
  if (session.messages.length > MAX_HISTORY) {
    session.messages = session.messages.slice(-MAX_HISTORY);
  }

  // Repair orphaned tool_result messages at the head of history.
  // After slicing, the first message(s) may be tool_results with no preceding
  // assistant turn that has toolCalls — this causes API errors on all providers.
  while (session.messages.length > 0 && session.messages[0].role === "tool_result") {
    session.messages.shift();
  }
}

/**
 * Rough token estimate: ~4 chars per token (GPT rule of thumb).
 * Used for auto-compaction threshold checks — precision isn't required.
 */
export function estimateTokens(messages: LLMMessage[]): number {
  return messages.reduce((sum, m) => {
    const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
    return sum + Math.ceil(content.length / 4);
  }, 0);
}
