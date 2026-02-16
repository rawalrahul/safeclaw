import { loadConfig } from "./core/config.js";
import { Gateway } from "./core/gateway.js";
import { createBot } from "./channels/telegram/client.js";
import { registerHandler } from "./channels/telegram/handler.js";
import { sendMessage } from "./channels/telegram/sender.js";

async function main(): Promise<void> {
  console.log("┌─────────────────────────────────────┐");
  console.log("│   SafeClaw — Secure AI Assistant     │");
  console.log("│   Sleep-by-default. You hold the keys│");
  console.log("└─────────────────────────────────────┘");

  // ─── Load Config ────────────────────────────────────
  const config = loadConfig();
  console.log(`[config] Owner Telegram ID: ${config.owner.telegramId}`);
  console.log(`[config] Storage: ${config.storageDir}`);
  console.log(`[config] Inactivity timeout: ${config.inactivityTimeoutMs / 60000}min`);

  // ─── Create Bot ─────────────────────────────────────
  const bot = createBot(config.telegramBotToken);

  // ─── Create Gateway (starts DORMANT) ────────────────
  const gw = new Gateway(config, async () => {
    // Called on auto-sleep due to inactivity
    console.log("[gateway] Auto-sleep triggered (inactivity)");
    try {
      await sendMessage(
        bot,
        config.owner.telegramId,
        "Auto-sleep: Gateway went dormant due to inactivity. Send /wake to reactivate."
      );
    } catch {
      // Owner chat might not be initialized yet
    }
  });

  console.log("[gateway] State: DORMANT (waiting for /wake from owner)");
  await gw.audit.log("gateway_wake", { event: "process_started", state: "dormant" });

  // ─── Register Message Handler ───────────────────────
  registerHandler(bot, gw, () => {
    console.log("[gateway] Shutdown requested via /kill");
    setTimeout(() => {
      bot.stop();
      process.exit(0);
    }, 500);
  });

  // ─── Start Polling ──────────────────────────────────
  console.log("[telegram] Starting bot polling...");
  bot.start({
    onStart: (botInfo) => {
      console.log(`[telegram] Bot online: @${botInfo.username}`);
      console.log(`[telegram] Send /wake from your Telegram to activate`);
      console.log("");
      console.log("Security status:");
      console.log("  ✓ Gateway: DORMANT (ignoring all messages except /wake)");
      console.log("  ✓ Tools: ALL DISABLED");
      console.log("  ✓ Authentication: single-owner (Telegram ID)");
      console.log(`  ✓ Owner: ${config.owner.telegramId}`);
      console.log("");
    },
  });

  // ─── Graceful Shutdown ──────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[shutdown] Received ${signal}, cleaning up...`);
    await gw.audit.log("gateway_kill", { reason: signal });
    bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
