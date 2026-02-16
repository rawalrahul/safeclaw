import type { ToolDefinition, ToolName, ToolStatus } from "../core/types.js";
import { TOOL_NAMES } from "../core/types.js";

const TOOL_DESCRIPTIONS: Record<ToolName, { description: string; dangerous: boolean }> = {
  browser: { description: "Web browsing and search", dangerous: true },
  filesystem: { description: "Read, write, and delete files", dangerous: true },
  shell: { description: "Execute shell commands", dangerous: true },
  code_exec: { description: "Run code snippets", dangerous: true },
  network: { description: "HTTP requests and API calls", dangerous: true },
  messaging: { description: "Send messages to contacts", dangerous: true },
};

export class ToolRegistry {
  private tools: Map<ToolName, ToolDefinition> = new Map();

  constructor() {
    // All tools disabled by default
    for (const name of TOOL_NAMES) {
      const meta = TOOL_DESCRIPTIONS[name];
      this.tools.set(name, {
        name,
        description: meta.description,
        dangerous: meta.dangerous,
        status: "disabled",
      });
    }
  }

  enable(name: ToolName): boolean {
    const tool = this.tools.get(name);
    if (!tool) return false;
    tool.status = "enabled";
    tool.lastEnabledAt = Date.now();
    return true;
  }

  disable(name: ToolName): boolean {
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

  isEnabled(name: ToolName): boolean {
    return this.tools.get(name)?.status === "enabled";
  }

  isDangerous(name: ToolName): boolean {
    return this.tools.get(name)?.dangerous ?? true;
  }

  get(name: ToolName): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  getEnabled(): ToolDefinition[] {
    return this.getAll().filter((t) => t.status === "enabled");
  }

  isValidTool(name: string): name is ToolName {
    return TOOL_NAMES.includes(name as ToolName);
  }

  formatStatus(): string {
    const lines = ["Tool Registry:"];
    for (const tool of this.tools.values()) {
      const icon = tool.status === "enabled" ? "ON " : "OFF";
      lines.push(`  ${icon}  ${tool.name} — ${tool.description}`);
    }
    return lines.join("\n");
  }
}
