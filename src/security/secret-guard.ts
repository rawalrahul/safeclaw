import { resolve, basename } from "node:path";
import { homedir } from "node:os";

const DENIED = "Access denied: this path is protected by SafeClaw security policy.";

/**
 * SecretGuard — prevents the LLM from reading or writing sensitive files.
 *
 * Protected paths:
 *   - Any .env or .env.* file
 *   - ~/.safeclaw/auth.json
 *   - ~/.safeclaw/*.json  (all JSON config files in the safeclaw storage dir)
 *   - Any file whose name contains: secret, password, credential, token (case-insensitive)
 */
export class SecretGuard {
  private readonly storageDir: string;

  constructor(storageDir: string) {
    this.storageDir = resolve(storageDir);
  }

  /** Returns true if the absolute path matches a protected pattern. */
  isProtectedPath(absPath: string): boolean {
    const normalized = resolve(absPath);
    const name = basename(normalized).toLowerCase();

    // .env and .env.* variants
    if (name === ".env" || name.startsWith(".env.")) return true;

    // ~/.safeclaw/auth.json  and  ~/.safeclaw/*.json
    const safeClawDir = resolve(homedir(), ".safeclaw");
    if (normalized.startsWith(safeClawDir + "/") || normalized.startsWith(safeClawDir + "\\")) {
      if (name.endsWith(".json")) return true;
    }
    // Also protect the storageDir itself (may differ from ~/.safeclaw)
    if (normalized.startsWith(this.storageDir + "/") || normalized.startsWith(this.storageDir + "\\")) {
      if (name.endsWith(".json")) return true;
    }

    // Filename keyword check (case-insensitive)
    if (
      name.includes("secret") ||
      name.includes("password") ||
      name.includes("credential") ||
      name.includes("token")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Check a file path. If protected, returns the denial message.
   * Otherwise returns null (caller should proceed).
   */
  checkPath(absPath: string): string | null {
    return this.isProtectedPath(absPath) ? DENIED : null;
  }
}

// ─── Shell output redaction ──────────────────────────────────

/** Pattern matching lines that look like KEY=VALUE env var assignments. */
const ENV_LINE_RE = /^([A-Z0-9_]*(SECRET|PASSWORD|TOKEN|KEY|CREDENTIAL)[A-Z0-9_]*)=(.*)$/im;

/**
 * Redact sensitive env var values from shell command output.
 * Replaces the value part with [REDACTED] while keeping the key name.
 */
export function redactEnvVars(output: string): string {
  return output
    .split("\n")
    .map((line) => {
      const m = line.match(ENV_LINE_RE);
      if (m) return `${m[1]}=[REDACTED]`;
      return line;
    })
    .join("\n");
}

/** Protected path patterns that shell commands should not be allowed to cat/read. */
const PROTECTED_READ_COMMANDS = [
  /\bcat\s+.*\.env\b/i,
  /\bcat\s+.*auth\.json\b/i,
  /\bcat\s+.*\.safeclaw[/\\]/i,
  /\btype\s+.*\.env\b/i,          // Windows "type" command
  /\bmore\s+.*\.env\b/i,
  /\bless\s+.*\.env\b/i,
  /\bhead\s+.*\.env\b/i,
  /\btail\s+.*\.env\b/i,
];

/**
 * Returns a denial message if the shell command is trying to read a protected file.
 * Returns null if the command should be allowed.
 */
export function checkShellCommand(command: string): string | null {
  for (const pattern of PROTECTED_READ_COMMANDS) {
    if (pattern.test(command)) {
      return DENIED;
    }
  }
  return null;
}
