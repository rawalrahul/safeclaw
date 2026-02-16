import type { OwnerIdentity } from "./types.js";

/**
 * Single-owner authentication.
 * Returns true only if the sender's Telegram ID matches the configured owner.
 * All other senders are silently rejected — no error, no response, no info leak.
 */
export function isOwner(owner: OwnerIdentity, senderId: number): boolean {
  return owner.telegramId === senderId;
}
