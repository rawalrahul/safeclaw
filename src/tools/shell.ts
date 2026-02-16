import type { ActionType } from "../core/types.js";

/** Simulated shell tool — returns mock responses for demonstration */
export function simulateShell(command: string): {
  action: ActionType;
  description: string;
  result: string;
} {
  return {
    action: "exec_shell",
    description: `Execute shell: ${command}`,
    result: `[Simulated] Shell output for: ${command}\n` +
      `  $ ${command}\n` +
      `  (simulated output)\n` +
      `  exit code: 0\n` +
      `\n(This is a simulated response — no command was actually executed)`,
  };
}
