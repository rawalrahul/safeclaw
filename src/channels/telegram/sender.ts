import type { Bot } from "grammy";

/**
 * Send a text message to a specific Telegram chat.
 * Uses Markdown parse mode for basic formatting.
 */
export async function sendMessage(
  bot: Bot,
  chatId: number,
  text: string
): Promise<void> {
  // Split long messages (Telegram limit: 4096 chars)
  const MAX_LEN = 4000;
  if (text.length <= MAX_LEN) {
    await bot.api.sendMessage(chatId, text);
    return;
  }

  // Split on newlines, staying under limit
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > MAX_LEN) {
      chunks.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    await bot.api.sendMessage(chatId, chunk);
  }
}
