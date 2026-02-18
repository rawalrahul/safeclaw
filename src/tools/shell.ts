import { exec } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_CHARS = 10_000;

/**
 * Execute a shell command and return its output.
 * Runs in the workspace directory as cwd.
 * Captures both stdout and stderr.
 * Times out after DEFAULT_TIMEOUT_MS.
 *
 * Inspired by OpenClaw's exec tool — simplified to synchronous single-shot
 * execution (no PTY, no background sessions) since dangerous actions already
 * require /confirm before we get here.
 */
export function execShell(command: string, workspaceDir: string): Promise<string> {
  return new Promise((resolve) => {
    const child = exec(
      command,
      { cwd: workspaceDir, timeout: DEFAULT_TIMEOUT_MS, encoding: "utf8" },
      (err, stdout, stderr) => {
        const out = typeof stdout === "string" ? stdout.trim() : "";
        const errOut = typeof stderr === "string" ? stderr.trim() : "";

        if (err) {
          if (err.killed || err.signal === "SIGTERM") {
            return resolve(`Command timed out after ${DEFAULT_TIMEOUT_MS / 1000}s.`);
          }
          const parts = [`Exit ${err.code ?? "?"}: ${err.message}`];
          if (out) parts.push(out);
          if (errOut) parts.push(`[stderr]\n${errOut}`);
          return resolve(truncate(parts.join("\n\n")));
        }

        const parts: string[] = [];
        if (out) parts.push(out);
        if (errOut) parts.push(`[stderr]\n${errOut}`);
        resolve(truncate(parts.join("\n\n") || "(no output)"));
      }
    );

    // Detach stdin so interactive prompts don't hang
    child.stdin?.end();
  });
}

function truncate(s: string): string {
  return s.length > MAX_OUTPUT_CHARS
    ? s.slice(0, MAX_OUTPUT_CHARS) + `\n[... truncated at ${MAX_OUTPUT_CHARS} chars]`
    : s;
}
