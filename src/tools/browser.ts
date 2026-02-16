import type { ActionType } from "../core/types.js";

/** Simulated browser tool — returns mock responses for demonstration */
export function simulateBrowser(query: string): {
  action: ActionType;
  description: string;
  result: string;
} {
  return {
    action: "browse_web",
    description: `Browse web: "${query}"`,
    result: `[Simulated] Search results for "${query}":\n` +
      `  1. Example result about ${query}\n` +
      `  2. Wikipedia article on ${query}\n` +
      `  3. News article about ${query}\n` +
      `\n(This is a simulated response — real browser tool not connected)`,
  };
}
