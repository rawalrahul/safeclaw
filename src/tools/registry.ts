import type { ToolDefinition, ToolStatus } from "../core/types.js";
import { BUILTIN_TOOL_NAMES } from "../core/types.js";
import type { DynamicSkill } from "../skills/dynamic.js";

const BUILTIN_TOOL_DESCRIPTIONS: Record<string, { description: string; dangerous: boolean }> = {
  browser: { description: "Web browsing and search", dangerous: true },
  filesystem: { description: "Read, write, and delete files", dangerous: true },
  shell: { description: "Execute shell commands", dangerous: true },
  patch: { description: "Apply code patches (add/update/delete/move files)", dangerous: true },
};

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  constructor() {
    // All builtin tools disabled by default
    for (const name of BUILTIN_TOOL_NAMES) {
      const meta = BUILTIN_TOOL_DESCRIPTIONS[name];
      this.tools.set(name, {
        name,
        description: meta.description,
        dangerous: meta.dangerous,
        status: "disabled",
      });
    }
  }

  enable(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    tool.status = "enabled";
    tool.lastEnabledAt = Date.now();
    return true;
  }

  disable(name: string): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    tool.status = "disabled";
    tool.lastDisabledAt = Date.now();
    return true;
  }

  disableAll(): void {
    for (const tool of this.tools.values()) {
      tool.status = "disabled";
    }
  }

  isEnabled(name: string): boolean {
    return this.tools.get(name)?.status === "enabled";
  }

  isDangerous(name: string): boolean {
    return this.tools.get(name)?.dangerous ?? true;
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  getEnabled(): ToolDefinition[] {
    return this.getAll().filter((t) => t.status === "enabled");
  }

  isValidTool(name: string): boolean {
    return this.tools.has(name) || name.startsWith("mcp:");
  }

  // ─── MCP-specific methods ──────────────────────────────────

  /** Register a single MCP-sourced tool definition. */
  registerMcp(def: ToolDefinition): void {
    this.tools.set(def.name, def);
  }

  /** Remove all MCP tools from the registry. */
  clearMcp(): void {
    for (const [key, tool] of this.tools) {
      if (tool.isMcp) {
        this.tools.delete(key);
      }
    }
  }

  /**
   * Enable all tools whose mcpServer matches serverName.
   * Returns the number of tools enabled.
   */
  enableByServer(serverName: string): number {
    let count = 0;
    for (const tool of this.tools.values()) {
      if (tool.isMcp && tool.mcpServer === serverName) {
        tool.status = "enabled";
        tool.lastEnabledAt = Date.now();
        count++;
      }
    }
    return count;
  }

  /**
   * Disable all tools whose mcpServer matches serverName.
   * Returns the number of tools disabled.
   */
  disableByServer(serverName: string): number {
    let count = 0;
    for (const tool of this.tools.values()) {
      if (tool.isMcp && tool.mcpServer === serverName) {
        tool.status = "disabled";
        tool.lastDisabledAt = Date.now();
        count++;
      }
    }
    return count;
  }

  // ─── Dynamic skill methods ────────────────────────────────

  /** Register a dynamic skill as a tool definition. Disabled by default. */
  registerDynamic(skill: DynamicSkill, enabled = false): void {
    const toolName = `skill__${skill.name}`;
    this.tools.set(toolName, {
      name: toolName,
      description: skill.description,
      dangerous: skill.dangerous,
      status: enabled ? "enabled" : "disabled",
      isDynamic: true,
      skillName: skill.name,
      skillParameters: skill.parameters,
    });
  }

  /** Remove all dynamic skill tools from the registry. */
  clearDynamic(): void {
    for (const [key, tool] of this.tools) {
      if (tool.isDynamic) {
        this.tools.delete(key);
      }
    }
  }

  formatStatus(): string {
    const builtins: ToolDefinition[] = [];
    const mcpByServer: Map<string, ToolDefinition[]> = new Map();
    const dynamics: ToolDefinition[] = [];

    for (const tool of this.tools.values()) {
      if (tool.isDynamic) {
        dynamics.push(tool);
      } else if (tool.isMcp && tool.mcpServer) {
        const group = mcpByServer.get(tool.mcpServer) ?? [];
        group.push(tool);
        mcpByServer.set(tool.mcpServer, group);
      } else {
        builtins.push(tool);
      }
    }

    const lines = ["Tool Registry:"];

    for (const tool of builtins) {
      const icon = tool.status === "enabled" ? "ON " : "OFF";
      lines.push(`  ${icon}  ${tool.name} — ${tool.description}`);
    }

    if (mcpByServer.size > 0) {
      lines.push("");
      lines.push("MCP Servers:");
      for (const [server, serverTools] of mcpByServer) {
        lines.push(`  ${server}:`);
        for (const tool of serverTools) {
          const icon = tool.status === "enabled" ? "ON " : "OFF";
          lines.push(`    ${icon}  ${tool.name} — ${tool.description}`);
        }
      }
    }

    if (dynamics.length > 0) {
      lines.push("");
      lines.push("Dynamic Skills (installed by agent):");
      for (const tool of dynamics) {
        const icon = tool.status === "enabled" ? "ON " : "OFF";
        const danger = tool.dangerous ? " ⚠️" : "";
        lines.push(`  ${icon}  ${tool.name} — ${tool.description}${danger}`);
      }
    }

    return lines.join("\n");
  }
}
