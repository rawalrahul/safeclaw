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

export function addAssistantMessage(session: ConversationSession, text: string): void {
  session.messages.push({ role: "assistant", content: text });
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
}
