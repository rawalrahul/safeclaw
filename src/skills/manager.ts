import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSkillFile, loadAllSkillFiles } from "./dynamic.js";
import type { DynamicSkill } from "./dynamic.js";

export class SkillsManager {
  private skillsDir: string;
  private skills: Map<string, DynamicSkill> = new Map();

  constructor(storageDir: string) {
    this.skillsDir = join(storageDir, "skills");
  }

  /** Load any skills persisted from previous sessions. */
  async init(): Promise<void> {
    await mkdir(this.skillsDir, { recursive: true });

    const loaded = await loadAllSkillFiles(this.skillsDir);
    for (const s of loaded) {
      this.skills.set(s.name, s);
    }

    if (loaded.length > 0) {
      const names = loaded.map((s) => s.name).join(", ");
      console.log(`[skills] Loaded ${loaded.length} dynamic skill(s): ${names}`);
    }
  }

  /**
   * Write code to disk and dynamically import it.
   * Returns the loaded skill (validates the export structure before returning).
   */
  async install(name: string, code: string): Promise<DynamicSkill> {
    const skillPath = join(this.skillsDir, `${name}.mjs`);
    await writeFile(skillPath, code, "utf8");

    const skill = await loadSkillFile(skillPath);
    this.skills.set(skill.name, skill);
    return skill;
  }

  getAll(): DynamicSkill[] {
    return [...this.skills.values()];
  }

  get(name: string): DynamicSkill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }
}
