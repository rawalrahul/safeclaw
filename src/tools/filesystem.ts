import type { ActionType } from "../core/types.js";

/** Simulated filesystem tool — returns mock responses for demonstration */
export function simulateReadFile(path: string): {
  action: ActionType;
  description: string;
  result: string;
} {
  return {
    action: "read_file",
    description: `Read file: ${path}`,
    result: `[Simulated] Contents of ${path}:\n` +
      `  line 1: example content\n` +
      `  line 2: more content\n` +
      `\n(This is a simulated response)`,
  };
}

export function simulateWriteFile(path: string, content: string): {
  action: ActionType;
  description: string;
  result: string;
} {
  return {
    action: "write_file",
    description: `Write file: ${path} (${content.length} chars)`,
    result: `[Simulated] File written: ${path} (${content.length} characters)\n` +
      `\n(This is a simulated response — no actual file was written)`,
  };
}

export function simulateDeleteFile(path: string): {
  action: ActionType;
  description: string;
  result: string;
} {
  return {
    action: "delete_file",
    description: `Delete file: ${path}`,
    result: `[Simulated] File deleted: ${path}\n` +
      `\n(This is a simulated response — no actual file was deleted)`,
  };
}
