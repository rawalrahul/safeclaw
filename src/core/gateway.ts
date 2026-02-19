import type { GatewayState, GatewaySession, SafeClawConfig, InfraContext } from "./types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ApprovalStore } from "../permissions/store.js";
import { AuditLogger } from "../audit/logger.js";
import { ProviderStore } from "../providers/store.js";
import type { ConversationSession } from "../agent/session.js";
import { createSession } from "../agent/session.js";
import { McpManager } from "../mcp/manager.js";
import { readMcpServersConfig } from "../mcp/config.js";
import { SkillsManager } from "../skills/manager.js";
import { loadPromptSkills } from "../skills/prompt-skills.js";
import type { PromptSkill } from "../skills/prompt-skills.js";
import { ProcessRegistry } from "../tools/process-registry.js";
import { closeBrowser } from "../tools/browser.js";
import { readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { probeInfra } from "../infra/probe.js";

export class Gateway {
  state: GatewayState = "dormant";
  session: GatewaySession | null = null;
  config: SafeClawConfig;
  tools: ToolRegistry;
  approvals: ApprovalStore;
  audit: AuditLogger;
  providerStore: ProviderStore;
  conversation: ConversationSession | null = null;
  mcpManager: McpManager;
  skillsManager: SkillsManager;
  processRegistry: ProcessRegistry;

  /** Custom persona text loaded from ~/.safeclaw/soul.md on wake. */
  soulPrompt: string | null = null;
  /** Prompt-only skills loaded from ~/.safeclaw/prompt-skills/*.md on wake. */
  promptSkills: PromptSkill[] = [];
  /** Probed system resources (CPU, RAM, GPU, Ollama models). Populated on wake. */
  infraContext: InfraContext | null = null;
  /**
   * Optional live-progress callback. Set by the Telegram handler before an agent run
   * so that tool execution can stream status messages (e.g. "Fetching https://...").
   * Cleared after each agent run.
   */
  progressCallback: ((msg: string) => Promise<void>) | null = null;
  /**
   * When true, the agent loop emits live Telegram messages for LLM thinking text
   * and safe tool calls/results. Persists across sleeps until toggled off.
   */
  verboseAudit: boolean = false;

  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private onAutoSleep?: () => void;

  constructor(config: SafeClawConfig, onAutoSleep?: () => void) {
    this.config = config;
    this.tools = new ToolRegistry();
    this.approvals = new ApprovalStore(config.approvalTimeoutMs);
    this.audit = new AuditLogger(config.storageDir);
    this.providerStore = new ProviderStore(config.storageDir);
    this.mcpManager = new McpManager();
    this.skillsManager = new SkillsManager(config.storageDir);
    this.processRegistry = new ProcessRegistry();
    this.onAutoSleep = onAutoSleep;
  }

  async init(): Promise<void> {
    await this.providerStore.load();
    await this.skillsManager.init();

    // Register any persisted dynamic skills in the tool registry (disabled by default)
    for (const skill of this.skillsManager.getAll()) {
      this.tools.registerDynamic(skill);
    }
  }

  // ─── State Transitions ────────────────────────────────────

  async wake(): Promise<string> {
    if (this.state === "awake") {
      this.touchActivity();
      return "Already awake. Use /tools to see available tools.";
    }

    this.state = "awake";
    this.session = { startedAt: Date.now(), lastActivityAt: Date.now() };
    this.tools.disableAll();
    this.tools.clearMcp(); // drop stale MCP tools from last session
    this.conversation = createSession();
    this.startInactivityTimer();

    await this.audit.log("gateway_wake");

    // Load soul file and prompt skills in background (non-blocking)
    void this.loadPersonality();

    // Probe system resources in background — fills gw.infraContext
    void this.probeSystemResources();

    // Fire-and-forget: MCP discovery runs in background so slow/unreachable
    // servers don't block the bot. Tools appear in /tools once discovery finishes.
    void this.connectMcpServers();

    const timeout = Math.round(this.config.inactivityTimeoutMs / 60000);
    return (
      `Gateway awake. All tools are disabled by default.\n` +
      `Auto-sleep in ${timeout} minutes of inactivity.\n\n` +
      `Use /tools to see tools, /enable <tool> to activate one.\n` +
      `Use /help for all commands.`
    );
  }

  /** Load soul.md and prompt skills from storage dir. Fire-and-forget on wake. */
  private async loadPersonality(): Promise<void> {
    // Soul file
    try {
      const soulPath = join(this.config.storageDir, "soul.md");
      this.soulPrompt = await readFile(soulPath, "utf8");
      console.log("[soul] Loaded soul.md custom persona.");
    } catch {
      this.soulPrompt = null; // Not present — use default persona
    }

    // Prompt skills
    const promptSkillsDir = join(this.config.storageDir, "prompt-skills");
    await mkdir(promptSkillsDir, { recursive: true });
    this.promptSkills = await loadPromptSkills(promptSkillsDir);
    const active = this.promptSkills.filter(s => s.active).length;
    if (this.promptSkills.length > 0) {
      console.log(`[skills] Loaded ${this.promptSkills.length} prompt skill(s), ${active} active.`);
    }
  }

  private async probeSystemResources(): Promise<void> {
    try {
      this.infraContext = await probeInfra();
      console.log(
        `[infra] CPU: ${this.infraContext.cpuCores} cores, ` +
        `RAM: ${this.infraContext.ramFreeGB.toFixed(1)}/${this.infraContext.ramTotalGB.toFixed(1)} GB free, ` +
        `GPUs: ${this.infraContext.gpus.length}, ` +
        `Ollama models: ${this.infraContext.ollamaModels.length}`
      );
    } catch {
      // Probe failure is non-critical
    }
  }

  private async connectMcpServers(): Promise<void> {
    const servers = readMcpServersConfig();
    const names = Object.keys(servers);
    if (names.length === 0) return;

    console.log(`[mcp] Discovering tools from ${names.length} server(s): ${names.join(", ")}`);

    await Promise.allSettled(
      names.map(async (name) => {
        const defs = await this.mcpManager.connectServer(name, servers[name]);
        for (const def of defs) {
          this.tools.registerMcp(def);
        }
      })
    );
  }

  async sleep(): Promise<string> {
    this.clearInactivityTimer();
    this.state = "dormant";
    this.session = null;
    this.conversation = null;
    this.soulPrompt = null;
    this.promptSkills = [];
    this.infraContext = null;
    this.tools.disableAll();
    this.tools.clearMcp();
    this.approvals.cleanupExpired();
    this.processRegistry.dispose();
    await Promise.all([this.mcpManager.disconnectAll(), closeBrowser()]);

    await this.audit.log("gateway_sleep");
    return "Gateway dormant. Goodnight.";
  }

  async kill(): Promise<string> {
    this.clearInactivityTimer();
    this.state = "shutdown";
    this.session = null;
    this.conversation = null;
    this.soulPrompt = null;
    this.promptSkills = [];
    this.infraContext = null;
    this.tools.disableAll();
    this.tools.clearMcp();
    this.processRegistry.dispose();
    await Promise.all([this.mcpManager.disconnectAll(), closeBrowser()]);

    await this.audit.log("gateway_kill");
    return "Emergency shutdown. Gateway stopped.";
  }

  async autoSleep(): Promise<void> {
    this.state = "dormant";
    this.session = null;
    this.conversation = null;
    this.soulPrompt = null;
    this.promptSkills = [];
    this.infraContext = null;
    this.tools.disableAll();
    this.tools.clearMcp();
    this.processRegistry.dispose();
    await Promise.all([this.mcpManager.disconnectAll(), closeBrowser()]);

    await this.audit.log("gateway_auto_sleep", {
      reason: "inactivity timeout",
    });
  }

  // ─── Activity Tracking ────────────────────────────────────

  touchActivity(): void {
    if (this.session) {
      this.session.lastActivityAt = Date.now();
    }
    this.resetInactivityTimer();
  }

  private startInactivityTimer(): void {
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(async () => {
      if (this.state === "awake") {
        await this.autoSleep();
        this.onAutoSleep?.();
      }
    }, this.config.inactivityTimeoutMs);
  }

  private resetInactivityTimer(): void {
    if (this.state === "awake") {
      this.startInactivityTimer();
    }
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }

  // ─── Status ───────────────────────────────────────────────

  formatStatus(): string {
    const lines = [`State: ${this.state.toUpperCase()}`];

    if (this.session) {
      const uptime = Math.round((Date.now() - this.session.startedAt) / 1000);
      const idle = Math.round((Date.now() - this.session.lastActivityAt) / 1000);
      lines.push(`Uptime: ${uptime}s`);
      lines.push(`Idle: ${idle}s`);
    }

    const enabled = this.tools.getEnabled();
    lines.push(`Tools enabled: ${enabled.length > 0 ? enabled.map((t) => t.name).join(", ") : "none"}`);

    const pending = this.approvals.listPending();
    if (pending.length > 0) {
      lines.push(`Pending approvals: ${pending.length}`);
    }

    if (this.infraContext) {
      const ic = this.infraContext;
      lines.push(`CPU: ${ic.cpuCores} cores`);
      lines.push(`RAM: ${ic.ramFreeGB.toFixed(1)}/${ic.ramTotalGB.toFixed(1)} GB free`);
      if (ic.gpus.length > 0) {
        lines.push(`GPU: ${ic.gpus.map((g) => g.name).join(", ")}`);
      }
      if (ic.ollamaModels.length > 0) {
        lines.push(`Ollama: ${ic.ollamaModels.map((m) => m.name).join(", ")}`);
      }
    }

    return lines.join("\n");
  }

  isAwake(): boolean {
    return this.state === "awake" || this.state === "action_pending";
  }
}
