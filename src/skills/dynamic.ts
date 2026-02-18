import { pathToFileURL } from "node:url";
import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

// ─── Skill Interface ──────────────────────────────────────────

export interface DynamicSkill {
  /** Short snake_case id, e.g. "pdf_create". LLM calls it as "skill__pdf_create". */
  name: string;
  description: string;
  /** If true, the action requires /confirm before executing. */
  dangerous: boolean;
  /** JSON Schema for the skill's parameters — passed to the LLM as the tool schema. */
  parameters: Record<string, unknown>;
  execute(params: Record<string, unknown>): Promise<string>;
}

interface DynamicSkillModule {
  skill: DynamicSkill;
}

// ─── Loader ───────────────────────────────────────────────────

/**
 * Dynamically import a single skill file.
 * Cache-busting via query param so updated files are re-read.
 */
export async function loadSkillFile(skillPath: string): Promise<DynamicSkill> {
  const url = `${pathToFileURL(skillPath).href}?v=${Date.now()}`;
  const mod = (await import(url)) as DynamicSkillModule;

  if (!mod.skill || typeof mod.skill.execute !== "function") {
    throw new Error(
      `Skill module must export a "skill" object with name, description, dangerous, parameters, and execute()`
    );
  }

  const { skill } = mod;
  if (!skill.name || typeof skill.dangerous !== "boolean" || !skill.parameters) {
    throw new Error(`Skill module is missing required fields: name, dangerous, parameters`);
  }

  return skill;
}

/**
 * Load all .mjs skill files from a directory.
 * Failures are logged and skipped — one bad skill doesn't block the rest.
 */
export async function loadAllSkillFiles(skillsDir: string): Promise<DynamicSkill[]> {
  if (!existsSync(skillsDir)) return [];

  const files = await readdir(skillsDir);
  const skills: DynamicSkill[] = [];

  for (const file of files) {
    if (!file.endsWith(".mjs")) continue;
    try {
      const skill = await loadSkillFile(join(skillsDir, file));
      skills.push(skill);
    } catch (err) {
      console.warn(`[skills] Failed to load "${file}":`, (err as Error).message);
    }
  }

  return skills;
}
