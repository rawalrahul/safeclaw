import type { ActionType } from "../core/types.js";

/** Simulated code execution tool — returns mock responses for demonstration */
export function simulateCodeExec(
  code: string
): { action: ActionType; description: string; result: string } {
  return {
    action: "exec_code",
    description: `Execute code snippet`,
    result:
      `[Simulated] Code executed:\n` +
      `  > ${code}\n` +
      `  Output: (simulated result)\n` +
      `\n(This is a simulated response — real code execution not connected)`,
  };
}
