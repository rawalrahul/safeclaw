import type { GatewayState, GatewaySession, SafeClawConfig } from "./types.js";
import { ToolRegistry } from "../tools/registry.js";
import { ApprovalStore } from "../permissions/store.js";
import { AuditLogger } from "../audit/logger.js";

export class Gateway {
  state: GatewayState = "dormant";
  session: GatewaySession | null = null;
  config: SafeClawConfig;
  tools: ToolRegistry;
  approvals: ApprovalStore;
  audit: AuditLogger;

  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private onAutoSleep?: () => void;

  constructor(config: SafeClawConfig, onAutoSleep?: () => void) {
    this.config = config;
    this.tools = new ToolRegistry();
    this.approvals = new ApprovalStore(config.approvalTimeoutMs);
    this.audit = new AuditLogger(config.storageDir);
    this.onAutoSleep = onAutoSleep;
  }

  // ─── State Transitions ────────────────────────────────────

  async wake(): Promise<string> {
    if (this.state === "awake") {
      this.touchActivity();
      return "Already awake. Use /tools to see available tools.";
    }

    this.state = "awake";
    this.session = { startedAt: Date.now(), lastActivityAt: Date.now() };
    this.tools.disableAll(); // fresh start: all tools off
    this.startInactivityTimer();

    await this.audit.log("gateway_wake");

    const timeout = Math.round(this.config.inactivityTimeoutMs / 60000);
    return (
      `Gateway awake. All tools are disabled by default.\n` +
      `Auto-sleep in ${timeout} minutes of inactivity.\n\n` +
      `Use /tools to see tools, /enable <tool> to activate one.\n` +
      `Use /help for all commands.`
    );
  }

  async sleep(): Promise<string> {
    this.clearInactivityTimer();
    this.state = "dormant";
    this.session = null;
    this.tools.disableAll();
    this.approvals.cleanupExpired();

    await this.audit.log("gateway_sleep");
    return "Gateway dormant. Goodnight.";
  }

  async kill(): Promise<string> {
    this.clearInactivityTimer();
    this.state = "shutdown";
    this.session = null;
    this.tools.disableAll();

    await this.audit.log("gateway_kill");
    return "Emergency shutdown. Gateway stopped.";
  }

  async autoSleep(): Promise<void> {
    this.state = "dormant";
    this.session = null;
    this.tools.disableAll();

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

    return lines.join("\n");
  }

  isAwake(): boolean {
    return this.state === "awake" || this.state === "action_pending";
  }
}
