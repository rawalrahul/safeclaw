import type { Bot, Context } from "grammy";
import type { Gateway } from "../../core/gateway.js";
import { isOwner } from "../../core/auth.js";
import { parseCommand } from "../../commands/parser.js";
import { handleCommand } from "../../commands/handlers.js";
import { sendMessage } from "./sender.js";
import { handleFreeText } from "./free-text.js";

/**
 * Register the message handler on the Telegram bot.
 *
 * Security flow:
 * 1. Check if sender is the authenticated owner → silent drop if not
 * 2. Parse for commands → route to command handler
 * 3. If not a command and gateway is awake → handle as free-text (tool invocation)
 * 4. If dormant → only /wake works, everything else silently ignored
 */
export function registerHandler(
  bot: Bot,
  gw: Gateway,
  onShutdown: () => void
): void {
  bot.on("message:text", async (ctx: Context) => {
    const senderId = ctx.from?.id;
    const chatId = ctx.chat?.id;
    const text = ctx.message?.text;

    if (!senderId || !chatId || !text) return;

    // ─── Step 1: Authentication ───────────────────────
    // Silent drop for non-owners. No response, no error, no info leak.
    if (!isOwner(gw.config.owner, senderId)) {
      await gw.audit.log("auth_rejected", { senderId });
      return; // silent drop
    }

    // ─── Step 2: Parse command ────────────────────────
    const cmd = parseCommand(text);

    if (cmd) {
      const result = await handleCommand(gw, cmd);
      await sendMessage(bot, chatId, result.reply);

      if (result.shouldShutdown) {
        onShutdown();
      }
      return;
    }

    // ─── Step 3: Free text (only when awake) ──────────
    if (!gw.isAwake()) {
      // Dormant: silently ignore non-command messages
      // Only /wake breaks through
      return;
    }

    gw.touchActivity();

    // Handle as a natural language request that may invoke tools
    const response = await handleFreeText(gw, text);
    await sendMessage(bot, chatId, response);
  });
}
