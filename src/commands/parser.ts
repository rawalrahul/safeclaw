import type { CommandName, ParsedCommand } from "../core/types.js";

const VALID_COMMANDS: CommandName[] = [
  "wake", "sleep", "kill", "tools", "enable", "disable",
  "confirm", "deny", "status", "audit", "help",
];

/**
 * Parse a message into a command, or return null if it's not a command.
 * Commands start with "/" followed by a valid command name.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase();

  if (!name || !VALID_COMMANDS.includes(name as CommandName)) {
    return null;
  }

  return {
    name: name as CommandName,
    args: parts.slice(1),
    raw: trimmed,
  };
}
