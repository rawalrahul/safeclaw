import type { ActionType } from "../core/types.js";

/** Simulated messaging tool — returns mock responses for demonstration */
export function simulateSendMessage(
  contact: string,
  message: string
): { action: ActionType; description: string; result: string } {
  return {
    action: "send_message",
    description: `Send message to ${contact}`,
    result:
      `[Simulated] Message sent to "${contact}":\n` +
      `  "${message}"\n` +
      `\n(This is a simulated response — real messaging not connected)`,
  };
}
