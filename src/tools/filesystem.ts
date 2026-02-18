import { readFile, writeFile, unlink, readdir, stat, lstat, realpath } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { existsSync } from "node:fs";
import type { ActionType } from "../core/types.js";
import { ensureDir } from "../storage/persistence.js";

/**
 * Resolve and validate a path is within the workspace sandbox.
 * Rejects path traversal attempts and symlinks pointing outside.
 */
export async function resolveSafePath(
  workspaceDir: string,
  userPath: string
): Promise<string> {
  await ensureDir(workspaceDir);

  const resolved = resolve(workspaceDir, userPath);
  const rel = relative(workspaceDir, resolved);

  // Check for path traversal (resolved path outside workspace)
  if (rel.startsWith("..") || resolve(resolved) !== resolved.replace(/[\\/]+$/, "")) {
    throw new Error(`Path rejected: "${userPath}" resolves outside the workspace.`);
  }

  // For existing paths, check that symlinks don't escape
  if (existsSync(resolved)) {
    try {
      const realPath = await realpath(resolved);
      const realRel = relative(workspaceDir, realPath);
      if (realRel.startsWith("..")) {
        throw new Error(`Path rejected: symlink "${userPath}" points outside the workspace.`);
      }
    } catch (err) {
      if ((err as Error).message.includes("Path rejected")) throw err;
      // File doesn't exist yet — that's fine for write operations
    }
  }

  return resolved;
}

// ─── Real Filesystem Operations ──────────────────────────────

export async function fsReadFile(
  workspaceDir: string,
  path: string
): Promise<{ action: ActionType; description: string; result: string }> {
  const safePath = await resolveSafePath(workspaceDir, path);
  const content = await readFile(safePath, "utf-8");
  return {
    action: "read_file",
    description: `Read file: ${path}`,
    result: content,
  };
}

export async function fsListDir(
  workspaceDir: string,
  path: string
): Promise<{ action: ActionType; description: string; result: string }> {
  const safePath = await resolveSafePath(workspaceDir, path || ".");
  const entries = await readdir(safePath);
  const lines: string[] = [];

  for (const entry of entries) {
    try {
      const entryPath = resolve(safePath, entry);
      const s = await stat(entryPath);
      const type = s.isDirectory() ? "dir " : "file";
      const size = s.isDirectory() ? "" : ` (${s.size} bytes)`;
      lines.push(`  ${type}  ${entry}${size}`);
    } catch {
      lines.push(`  ???   ${entry}`);
    }
  }

  return {
    action: "list_dir",
    description: `List directory: ${path || "."}`,
    result: lines.length > 0
      ? `Contents of ${path || "."}:\n${lines.join("\n")}`
      : `Directory ${path || "."} is empty.`,
  };
}

export async function fsWriteFile(
  workspaceDir: string,
  path: string,
  content: string
): Promise<{ action: ActionType; description: string; result: string }> {
  const safePath = await resolveSafePath(workspaceDir, path);

  // Ensure parent directory exists
  const parentDir = resolve(safePath, "..");
  await ensureDir(parentDir);

  await writeFile(safePath, content, "utf-8");
  return {
    action: "write_file",
    description: `Write file: ${path} (${content.length} chars)`,
    result: `File written: ${path} (${content.length} characters)`,
  };
}

export async function fsDeleteFile(
  workspaceDir: string,
  path: string
): Promise<{ action: ActionType; description: string; result: string }> {
  const safePath = await resolveSafePath(workspaceDir, path);
  await unlink(safePath);
  return {
    action: "delete_file",
    description: `Delete file: ${path}`,
    result: `File deleted: ${path}`,
  };
}
