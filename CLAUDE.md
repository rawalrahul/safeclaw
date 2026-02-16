# SafeClaw — Project Guidelines

## What This Is

SafeClaw is a **secure, privacy-first personal AI assistant** inspired by OpenClaw but redesigned from the ground up with security as the default. It connects to Telegram (and later WhatsApp) as its own bot identity — it never impersonates the user.

## Core Security Model

### 1. Sleep-by-Default
The gateway starts **dormant**. It only processes messages when the authenticated owner sends `/wake`. After 30 minutes of inactivity (configurable), it auto-sleeps. While dormant, it silently ignores everything except `/wake` from the owner.

### 2. Separate Bot Identity
Unlike OpenClaw (which hijacks the user's WhatsApp session via Baileys), SafeClaw runs as its own Telegram bot / WhatsApp Business number. The user chats with it like they'd chat with Meta AI or ChatGPT. External users don't know the bot exists.

### 3. Tools Off by Default
Every tool (browser, filesystem, shell, code_exec, network, messaging) is **disabled** on each wake. The owner explicitly enables tools via `/enable <tool>` and revokes with `/disable <tool>`. Disabled tools are invisible to the AI agent.

### 4. Permission Before Action
Even when a tool is enabled, **dangerous actions** (write, delete, execute, send) require explicit `/confirm <id>` from the owner. Read-only actions proceed without confirmation. Unconfirmed actions auto-deny after 5 minutes.

### 5. Single Owner
Only one Telegram user ID is authorized. All messages from other senders are silently dropped — no response, no error, no information leak.

### 6. Full Audit Trail
Every action is logged to `~/.safeclaw/audit.jsonl`. The owner can review recent events via `/audit [count]`.

## Commands

| Command | Description | Requires Awake |
|---------|-------------|----------------|
| `/wake` | Wake the gateway | No (this IS the wake) |
| `/sleep` | Return to dormant | Yes |
| `/kill` | Emergency shutdown | Yes |
| `/tools` | List all tools and status | Yes |
| `/enable <tool>` | Enable a tool | Yes |
| `/disable <tool>` | Disable a tool | Yes |
| `/confirm <id>` | Approve a pending action | Yes |
| `/deny <id>` | Reject a pending action | Yes |
| `/status` | Show gateway state | Yes |
| `/audit [n]` | Show last N audit events | Yes |

## Architecture

```
safeclaw/
├── src/
│   ├── index.ts              # Entry point
│   ├── core/                 # Gateway state machine, auth, config, types
│   ├── channels/telegram/    # grammy bot client, message handler, sender
│   ├── tools/                # Tool registry + simulated tool stubs
│   ├── permissions/          # Confirmation flow and pending approval store
│   ├── audit/                # JSONL event logger
│   ├── commands/             # Command parser and handlers
│   └── storage/              # File-based persistence
├── package.json
├── tsconfig.json
└── .env.example              # TELEGRAM_BOT_TOKEN, OWNER_TELEGRAM_ID
```

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (strict mode)
- **Telegram**: grammy library
- **Storage**: File-based JSON + JSONL (no database)
- **Dependencies**: grammy, dotenv, uuid (minimal footprint)

## Development

```bash
# Install
cd safeclaw && npm install

# Configure
cp .env.example .env
# Edit .env with your Telegram bot token and owner ID

# Run
npx tsx src/index.ts
```

## Security Comparison with OpenClaw

| Aspect | OpenClaw | SafeClaw |
|--------|----------|----------|
| Identity | Hijacks user's WhatsApp | Own bot number |
| Default state | Always-on daemon | Dormant until `/wake` |
| Tool access | Static config profiles | Runtime enable/disable |
| Dangerous actions | Executes immediately | Requires `/confirm` |
| Auth model | DM pairing (reactive) | Single owner by Telegram ID |
| Audit | Security audit command | Continuous JSONL audit log |
| Inbound from strangers | Pairing code response | Silent drop (zero info leak) |
