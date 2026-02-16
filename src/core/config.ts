import { config } from "dotenv";
import { join } from "node:path";
import { homedir } from "node:os";
import type { SafeClawConfig } from "./types.js";

export function loadConfig(): SafeClawConfig {
  config(); // load .env

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token || token === "your_bot_token_here") {
    console.error("ERROR: TELEGRAM_BOT_TOKEN is required in .env");
    process.exit(1);
  }

  const ownerId = process.env.OWNER_TELEGRAM_ID;
  if (!ownerId || ownerId === "123456789") {
    console.error("ERROR: OWNER_TELEGRAM_ID is required in .env");
    process.exit(1);
  }

  const inactivityMin = parseInt(process.env.INACTIVITY_TIMEOUT_MINUTES || "30", 10);
  const approvalMin = parseInt(process.env.APPROVAL_TIMEOUT_MINUTES || "5", 10);
  const storageDir = process.env.STORAGE_DIR || join(homedir(), ".safeclaw");

  return {
    owner: { telegramId: parseInt(ownerId, 10) },
    telegramBotToken: token,
    inactivityTimeoutMs: inactivityMin * 60 * 1000,
    approvalTimeoutMs: approvalMin * 60 * 1000,
    storageDir,
  };
}
