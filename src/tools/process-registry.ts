import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { v4 as uuidv4 } from "uuid";

const MAX_BUFFER_CHARS = 100_000;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface ProcessSession {
  id: string;
  command: string;
  process: ChildProcess;
  /** Accumulated stdout + stderr output. Bounded to MAX_BUFFER_CHARS. */
  outputBuffer: string;
  exitCode: number | null;
  startedAt: number;
  /** Timestamp when the process exited. Null while still running. */
  diedAt: number | null;
}

/**
 * Registry for long-running background shell processes.
 * Spawned processes accumulate output in a ring buffer.
 * Dead sessions are swept every 5 minutes; TTL is 30 minutes after exit.
 */
export class ProcessRegistry {
  private sessions: Map<string, ProcessSession> = new Map();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.sweepDead(), 5 * 60 * 1000);
  }

  /** Spawn a background process. Returns the short session ID. */
  spawn(command: string, workspaceDir: string): string {
    const id = uuidv4().slice(0, 8);

    const child = spawn(command, {
      shell: true,
      cwd: workspaceDir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const session: ProcessSession = {
      id,
      command,
      process: child,
      outputBuffer: "",
      exitCode: null,
      startedAt: Date.now(),
      diedAt: null,
    };

    const append = (chunk: string) => {
      session.outputBuffer += chunk;
      if (session.outputBuffer.length > MAX_BUFFER_CHARS) {
        // Keep the tail — most recent output is most useful
        session.outputBuffer = "[... older output truncated ...]\n" +
          session.outputBuffer.slice(-MAX_BUFFER_CHARS);
      }
    };

    child.stdout?.on("data", (data: Buffer) => append(data.toString()));
    child.stderr?.on("data", (data: Buffer) => append(`[stderr] ${data.toString()}`));
    child.on("close", (code) => {
      session.exitCode = code ?? -1;
      session.diedAt = Date.now();
      session.outputBuffer += `\n[Process exited with code ${session.exitCode}]`;
    });
    child.on("error", (err) => {
      session.outputBuffer += `\n[Spawn error: ${err.message}]`;
      session.exitCode = -1;
      session.diedAt = Date.now();
    });

    this.sessions.set(id, session);
    return id;
  }

  /** Return accumulated output from a background process. */
  poll(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return `Session "${sessionId}" not found.`;

    const status =
      session.exitCode !== null
        ? `[Process exited: code ${session.exitCode}]`
        : "[Process still running]";

    if (!session.outputBuffer) return `(no output yet) — ${status}`;
    return `${session.outputBuffer}\n${status}`;
  }

  /** Write a line to the process's stdin. */
  write(sessionId: string, input: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return `Session "${sessionId}" not found.`;
    if (session.exitCode !== null) return `Session "${sessionId}" has already exited.`;

    const payload = input.endsWith("\n") ? input : input + "\n";
    session.process.stdin?.write(payload);
    return `Written to session ${sessionId}.`;
  }

  /** Send SIGTERM to a running process. */
  kill(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return `Session "${sessionId}" not found.`;
    if (session.exitCode !== null) return `Session "${sessionId}" has already exited.`;

    session.process.kill("SIGTERM");
    return `Sent SIGTERM to session ${sessionId}.`;
  }

  /** List all tracked sessions (running and recently exited). */
  list(): string {
    if (this.sessions.size === 0) return "No background process sessions.";
    const lines = ["Background sessions:"];
    for (const s of this.sessions.values()) {
      const status =
        s.exitCode !== null ? `exited(${s.exitCode})` : "running";
      const age = Math.round((Date.now() - s.startedAt) / 1000);
      lines.push(`  ${s.id}  [${status}]  ${age}s  ${s.command}`);
    }
    return lines.join("\n");
  }

  /** Kill all running processes and stop the cleanup timer. Called on sleep/kill. */
  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    for (const session of this.sessions.values()) {
      if (session.exitCode === null) {
        try { session.process.kill("SIGTERM"); } catch { /* already dead */ }
      }
    }
    this.sessions.clear();
  }

  /** Remove sessions that have been dead longer than SESSION_TTL_MS. */
  private sweepDead(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.diedAt && now - session.diedAt > SESSION_TTL_MS) {
        this.sessions.delete(id);
      }
    }
  }
}
