import { Bot } from "grammy";

/**
 * Create and configure the Telegram bot instance.
 * The bot is its own identity — a separate Telegram account.
 * Nobody knows it exists unless they have the bot username.
 */
export function createBot(token: string): Bot {
  const bot = new Bot(token);

  // Prevent grammy from throwing on polling errors
  bot.catch((err) => {
    console.error("[telegram] Bot error:", err.message);
  });

  return bot;
}
