import { readdir, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { accessSync, constants } from "node:fs";

export interface PromptSkill {
  /** Filename without .md — used as the skill key. */
  name: string;
  /** Human-readable title from frontmatter or derived from filename. */
  title: string;
  /** Markdown body to inject verbatim into the system prompt. */
  content: string;
  /** All bins that must be present on PATH for this skill to activate. */
  requiresBins: string[];
  /** At least one of these bins must be present (anyBins). */
  anyBins: string[];
  /** True when all bin requirements are satisfied. */
  active: boolean;
}

/**
 * Split YAML frontmatter from a markdown file.
 * Returns the YAML block (raw string) and the body text.
 */
function splitFrontmatter(raw: string): { yaml: string; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { yaml: "", body: raw };
  return { yaml: match[1], body: match[2] };
}

/**
 * Extract a list of binary names from a YAML block.
 * Handles both inline `key: [a, b]` and multi-line `- a\n- b` list syntax.
 */
function extractBinList(yaml: string, key: string): string[] {
  // Inline array: key: [bin1, bin2]
  const inlineMatch = yaml.match(new RegExp(`(?:^|\\n)[ \\t]*${key}:\\s*\\[([^\\]]*?)\\]`));
  if (inlineMatch) {
    return inlineMatch[1]
      .split(",")
      .map(s => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }

  // Multi-line list under key: (any indentation)
  const blockMatch = yaml.match(new RegExp(`(?:^|\\n)[ \\t]*${key}:[\\s\\S]*?(?=\\n[ \\t]*\\S|$)`));
  if (blockMatch) {
    return [...blockMatch[0].matchAll(/\n[ \t]*-[ \t]+(.+)/g)].map(m =>
      m[1].trim().replace(/^["']|["']$/g, "")
    );
  }

  return [];
}

/** Extract a title from frontmatter or derive one from the filename. */
function extractTitle(yaml: string, name: string): string {
  const match = yaml.match(/(?:^|\n)[ \t]*title:\s*["']?(.+?)["']?(?:\r?\n|$)/);
  return match ? match[1].trim() : name.replace(/[-_]/g, " ");
}

/** Return true if the given binary name can be found on PATH. */
function binExists(name: string): boolean {
  const pathSep = process.platform === "win32" ? ";" : ":";
  const dirs = (process.env.PATH || "").split(pathSep);
  const exts =
    process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      try {
        accessSync(join(dir, name + ext), constants.F_OK);
        return true;
      } catch {
        // Not found in this dir
      }
    }
  }
  return false;
}

/**
 * Load all SKILL.md files from the given directory.
 * Checks binary requirements and marks skills as active/inactive.
 *
 * Frontmatter format (YAML between --- delimiters):
 *   title: My Skill        # optional friendly name
 *   bins: [git, curl]      # ALL of these must exist on PATH
 *   anyBins: [jq, python3] # AT LEAST ONE of these must exist
 *   requires:
 *     bins: [gh, jq]       # nested form is also supported
 *
 * Body: any markdown text. Injected verbatim into the system prompt for active skills.
 */
export async function loadPromptSkills(skillsDir: string): Promise<PromptSkill[]> {
  try {
    await mkdir(skillsDir, { recursive: true });
    const files = await readdir(skillsDir);
    const mdFiles = files.filter(f => f.endsWith(".md") && !f.startsWith("."));

    const skills: PromptSkill[] = [];
    for (const file of mdFiles) {
      try {
        const raw = await readFile(join(skillsDir, file), "utf8");
        const { yaml, body } = splitFrontmatter(raw);

        // Support both top-level `bins:` and nested `requires:\n  bins:`
        const requiresBins = extractBinList(yaml, "bins");
        const anyBins = extractBinList(yaml, "anyBins");
        const title = extractTitle(yaml, file.replace(/\.md$/, ""));

        const allBinsPresent = requiresBins.every(binExists);
        const anyBinPresent = anyBins.length === 0 || anyBins.some(binExists);

        skills.push({
          name: file.replace(/\.md$/, ""),
          title,
          content: body.trim(),
          requiresBins,
          anyBins,
          active: allBinsPresent && anyBinPresent,
        });
      } catch {
        // Skip unreadable or malformed skill files
      }
    }

    return skills;
  } catch {
    return [];
  }
}

/** Format a list of prompt skills for display in /skills. */
export function formatPromptSkills(skills: PromptSkill[]): string {
  if (skills.length === 0) {
    return (
      "No prompt skills found.\n\n" +
      "To add skills, drop .md files into ~/.safeclaw/prompt-skills/\n" +
      "Each file is a markdown document injected into the system prompt.\n\n" +
      "Optional YAML frontmatter:\n" +
      "  ---\n" +
      "  title: My Skill\n" +
      "  bins: [git, curl]   # required binaries\n" +
      "  anyBins: [jq, python3]  # at least one required\n" +
      "  ---"
    );
  }

  const lines = [`Prompt Skills (${skills.filter(s => s.active).length}/${skills.length} active):\n`];
  for (const s of skills) {
    const icon = s.active ? "ON " : "OFF";
    const binNote = s.requiresBins.length > 0 || s.anyBins.length > 0
      ? ` [needs: ${[...s.requiresBins, ...s.anyBins.map(b => `${b}?`)].join(", ")}]`
      : "";
    lines.push(`  ${icon}  ${s.title}${binNote}`);
  }

  lines.push("\nActive skills are injected into the system prompt on each wake.");
  return lines.join("\n");
}
