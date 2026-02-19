import { config } from "dotenv";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import type { SafeClawConfig } from "./types.js";

interface TelegramConfig {
  botToken: string;
  ownerTelegramId: number;
}

const TELEGRAM_JSON_PATH = join(homedir(), ".safeclaw", "telegram.json");

/** Read Telegram credentials from ~/.safeclaw/telegram.json if it exists. */
function readTelegramJson(): TelegramConfig | null {
  try {
    if (!existsSync(TELEGRAM_JSON_PATH)) return null;
    const raw = readFileSync(TELEGRAM_JSON_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<TelegramConfig>;
    if (parsed.botToken && parsed.ownerTelegramId) {
      return { botToken: parsed.botToken, ownerTelegramId: parsed.ownerTelegramId };
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist Telegram credentials to ~/.safeclaw/telegram.json. */
function writeTelegramJson(creds: TelegramConfig): void {
  mkdirSync(join(homedir(), ".safeclaw"), { recursive: true });
  writeFileSync(TELEGRAM_JSON_PATH, JSON.stringify(creds, null, 2), "utf8");
}

export function loadConfig(): SafeClawConfig {
  config(); // load .env (may be empty after migration)

  // ── Resolve Telegram credentials ──────────────────────────
  // Priority: ~/.safeclaw/telegram.json (secure, out of project) → .env fallback
  let telegramCreds = readTelegramJson();

  if (!telegramCreds) {
    // First run: read from .env, then migrate to ~/.safeclaw/telegram.json
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const ownerId = process.env.OWNER_TELEGRAM_ID;

    if (!token || token === "your_bot_token_here") {
      console.error("ERROR: TELEGRAM_BOT_TOKEN not found.");
      console.error("  Option A (first run): set TELEGRAM_BOT_TOKEN in .env");
      console.error("  Option B (secure):   create ~/.safeclaw/telegram.json:");
      console.error('    { "botToken": "<token>", "ownerTelegramId": <id> }');
      process.exit(1);
    }
    if (!ownerId || ownerId === "123456789") {
      console.error("ERROR: OWNER_TELEGRAM_ID not found in .env");
      process.exit(1);
    }

    telegramCreds = { botToken: token, ownerTelegramId: parseInt(ownerId, 10) };

    // Auto-migrate: save to ~/.safeclaw/telegram.json so .env can be cleared
    try {
      writeTelegramJson(telegramCreds);
      console.log("[config] Telegram credentials saved to ~/.safeclaw/telegram.json");
      console.log("[config] You can now remove TELEGRAM_BOT_TOKEN and OWNER_TELEGRAM_ID from .env");
    } catch {
      // Non-fatal — just continue with env vars
    }
  }

  const inactivityMin = parseInt(process.env.INACTIVITY_TIMEOUT_MINUTES || "30", 10);
  const approvalMin = parseInt(process.env.APPROVAL_TIMEOUT_MINUTES || "5", 10);
  const storageDir = process.env.STORAGE_DIR || join(homedir(), ".safeclaw");
  const workspaceDir = process.env.WORKSPACE_DIR || join(homedir(), "safeclaw-workspace");

  return {
    owner: { telegramId: telegramCreds.ownerTelegramId },
    telegramBotToken: telegramCreds.botToken,
    inactivityTimeoutMs: inactivityMin * 60 * 1000,
    approvalTimeoutMs: approvalMin * 60 * 1000,
    storageDir,
    workspaceDir,
  };
}
