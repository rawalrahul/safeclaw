import { readFile, writeFile, unlink, rename, mkdir } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";

/**
 * Apply a patch in OpenClaw/OpenAI apply_patch format.
 *
 * Supported directives:
 *   *** Add File: <path>
 *   *** Delete File: <path>
 *   *** Update File: <path>
 *   *** Move to: <path>   (used after an Update File block to rename)
 *
 * Update blocks use context-diff style:
 *   Lines starting with " " are context (must match existing file).
 *   Lines starting with "-" are removed.
 *   Lines starting with "+" are added.
 *   @@ ... @@ markers are optional hints (ignored by this parser).
 *
 * Wrap the whole patch in:
 *   *** Begin Patch
 *   ... directives ...
 *   *** End Patch
 *
 * All paths are sandboxed to workspaceDir.
 * Inspired by OpenClaw's src/agents/apply-patch.ts.
 */
export async function applyPatch(patchText: string, workspaceDir: string): Promise<string> {
  // Strip optional heredoc wrapper
  const cleaned = patchText
    .replace(/^<<\s*['"]?EOF['"]?\s*\n?/i, "")
    .replace(/\nEOF\s*$/i, "")
    .trim();

  // Find begin/end markers
  const beginIdx = cleaned.indexOf("*** Begin Patch");
  const endIdx = cleaned.indexOf("*** End Patch");

  if (beginIdx === -1 || endIdx === -1) {
    return "Invalid patch: missing *** Begin Patch / *** End Patch markers.";
  }

  const body = cleaned.slice(beginIdx + "*** Begin Patch".length, endIdx).trim();
  const lines = body.split("\n");

  const results: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith("*** Add File: ")) {
      const relPath = line.slice("*** Add File: ".length).trim();
      const absPath = sandboxPath(relPath, workspaceDir);
      if (!absPath) { results.push(`SKIP (path escape): ${relPath}`); i++; continue; }

      // Collect file content until next *** directive or end
      i++;
      const content = collectContent(lines, i);
      i += content.lineCount;

      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, content.text, "utf8");
      results.push(`Added: ${relPath}`);

    } else if (line.startsWith("*** Delete File: ")) {
      const relPath = line.slice("*** Delete File: ".length).trim();
      const absPath = sandboxPath(relPath, workspaceDir);
      if (!absPath) { results.push(`SKIP (path escape): ${relPath}`); i++; continue; }

      await unlink(absPath);
      results.push(`Deleted: ${relPath}`);
      i++;

    } else if (line.startsWith("*** Update File: ")) {
      const relPath = line.slice("*** Update File: ".length).trim();
      const absPath = sandboxPath(relPath, workspaceDir);
      if (!absPath) { results.push(`SKIP (path escape): ${relPath}`); i++; continue; }

      i++;

      // Check for optional Move to
      let moveTo: string | null = null;
      if (i < lines.length && lines[i].startsWith("*** Move to: ")) {
        moveTo = lines[i].slice("*** Move to: ".length).trim();
        i++;
      }

      // Collect the diff hunks
      const hunks = collectHunks(lines, i);
      i += hunks.lineCount;

      let original: string;
      try {
        original = await readFile(absPath, "utf8");
      } catch {
        results.push(`FAIL (cannot read): ${relPath}`);
        continue;
      }

      const patched = applyHunks(original, hunks.hunks);
      if (patched === null) {
        results.push(`FAIL (hunk mismatch): ${relPath}`);
        continue;
      }

      await writeFile(absPath, patched, "utf8");

      if (moveTo) {
        const moveAbs = sandboxPath(moveTo, workspaceDir);
        if (moveAbs) {
          await mkdir(dirname(moveAbs), { recursive: true });
          await rename(absPath, moveAbs);
          results.push(`Updated + Moved: ${relPath} → ${moveTo}`);
        } else {
          results.push(`Updated (move skipped, path escape): ${relPath}`);
        }
      } else {
        results.push(`Updated: ${relPath}`);
      }

    } else {
      i++;
    }
  }

  return results.length > 0 ? results.join("\n") : "No patch operations found.";
}

// ─── Helpers ──────────────────────────────────────────────────

function sandboxPath(relPath: string, workspaceDir: string): string | null {
  const abs = resolve(join(workspaceDir, relPath));
  if (!abs.startsWith(resolve(workspaceDir))) return null;
  return abs;
}

interface CollectedContent {
  text: string;
  lineCount: number;
}

/** Collect raw lines until a *** directive or EOF. */
function collectContent(lines: string[], start: number): CollectedContent {
  const collected: string[] = [];
  let i = start;
  while (i < lines.length && !lines[i].startsWith("*** ")) {
    collected.push(lines[i]);
    i++;
  }
  return { text: collected.join("\n"), lineCount: i - start };
}

interface Hunk {
  context: string[];
  removes: string[];
  adds: string[];
}

interface CollectedHunks {
  hunks: Array<{ removes: string[]; adds: string[] }>;
  lineCount: number;
}

/** Collect diff hunks: lines with " " (context), "-" (remove), "+" (add). */
function collectHunks(lines: string[], start: number): CollectedHunks {
  const hunks: Array<{ removes: string[]; adds: string[] }> = [];
  let i = start;
  let currentRemoves: string[] = [];
  let currentAdds: string[] = [];

  function flush() {
    if (currentRemoves.length > 0 || currentAdds.length > 0) {
      hunks.push({ removes: currentRemoves, adds: currentAdds });
      currentRemoves = [];
      currentAdds = [];
    }
  }

  while (i < lines.length && !lines[i].startsWith("*** ")) {
    const line = lines[i];
    if (line.startsWith("@@")) {
      flush();
    } else if (line.startsWith("-")) {
      currentRemoves.push(line.slice(1));
    } else if (line.startsWith("+")) {
      currentAdds.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      flush();
    }
    i++;
  }
  flush();

  return { hunks, lineCount: i - start };
}

/** Apply hunks to original file content. Returns null on mismatch. */
function applyHunks(
  original: string,
  hunks: Array<{ removes: string[]; adds: string[] }>
): string | null {
  let result = original;

  for (const hunk of hunks) {
    if (hunk.removes.length === 0 && hunk.adds.length > 0) {
      // Pure addition — append
      result += "\n" + hunk.adds.join("\n");
      continue;
    }

    const removeBlock = hunk.removes.join("\n");
    const addBlock = hunk.adds.join("\n");
    const idx = result.indexOf(removeBlock);

    if (idx === -1) {
      return null; // Hunk didn't match
    }

    result = result.slice(0, idx) + addBlock + result.slice(idx + removeBlock.length);
  }

  return result;
}
