# SafeClaw — Secure Personal AI Assistant

**Sleep-by-default. Tools off by default. You hold the keys.**

SafeClaw is a secure, privacy-first personal AI assistant you control from your phone via Telegram (and soon WhatsApp). Unlike other AI gateways that run always-on with broad permissions, SafeClaw inverts the defaults: everything is off until you explicitly turn it on.

## Why SafeClaw?

Most AI assistant gateways have a trust problem:

| Problem | SafeClaw's Answer |
|---------|-------------------|
| Bot hijacks your messaging account | **Own identity** — SafeClaw is its own Telegram bot, never impersonates you |
| Always-on daemon with large attack surface | **Dormant by default** — only wakes when you send `/wake` |
| Static tool permissions set at config time | **Runtime toggle** — `/enable browser`, `/disable shell`, on the fly |
| Dangerous actions execute immediately | **Explicit approval** — every write, delete, and execute requires `/confirm` |
| Unknown senders get error responses (info leak) | **Silent drop** — non-owners get zero response, zero acknowledgment |

## Quick Start

### 1. Create a Telegram Bot

Message [@BotFather](https://t.me/BotFather) on Telegram and create a new bot. Copy the token.

### 2. Find Your Telegram ID

Message [@userinfobot](https://t.me/userinfobot) on Telegram. Copy your numeric user ID.

### 3. Configure

```bash
cd safeclaw
cp .env.example .env
# Edit .env:
#   TELEGRAM_BOT_TOKEN=your_bot_token
#   OWNER_TELEGRAM_ID=your_user_id
```

### 4. Install & Run

```bash
npm install
npx tsx src/index.ts
```

### 5. Chat with Your Bot

Open Telegram, find your bot, and send `/wake`. That's it.

## Commands

```
/wake              — Wake the gateway (only command that works while dormant)
/sleep             — Go back to dormant
/kill              — Emergency shutdown

/tools             — See all tools and their ON/OFF status
/enable <tool>     — Enable a tool (browser, filesystem, shell, code_exec, network, messaging)
/disable <tool>    — Disable a tool

/confirm <id>      — Approve a pending dangerous action
/deny <id>         — Reject it

/status            — Gateway state, uptime, enabled tools
/audit [n]         — Last N audit log events
/help              — All commands
```

## How It Works

```
You (Telegram) ──→ SafeClaw Bot ──→ Gateway State Machine
                                        │
                        ┌───────────────┼───────────────┐
                        │               │               │
                   Auth Check     Tool Registry    Audit Log
                   (owner only)   (all OFF)        (every event)
                        │               │
                   Silent drop    Permission Gate
                   if not owner   (/confirm required)
```

**Example flow:**

```
You:   /wake
Bot:   Gateway awake. All tools disabled. Auto-sleep in 30 min.

You:   /enable browser
Bot:   browser is now ENABLED. Dangerous actions still require /confirm.

You:   search latest AI news
Bot:   Action pending approval:
         Tool: browser
         Action: browse_web
         Details: browse_web: latest AI news
         Expires in: 300s
       Reply /confirm a1b2c3d4 or /deny a1b2c3d4

You:   /confirm a1b2c3d4
Bot:   Approved. Executing...
       [Search results for "latest AI news"]

You:   /sleep
Bot:   Gateway dormant. Goodnight.
```

## Security Model

- **Sleep-by-default**: Gateway starts dormant and ignores all messages except `/wake` from the owner
- **Single owner**: Only your Telegram user ID is authorized. Everyone else is silently ignored
- **Tools off by default**: All 6 tool categories disabled on every wake. You enable what you need
- **Confirm before action**: Write, delete, execute, and send operations require `/confirm`
- **Auto-sleep**: 30-minute inactivity timeout returns to dormant (configurable)
- **Full audit trail**: Every event logged to `~/.safeclaw/audit.jsonl`
- **Separate identity**: Bot is its own Telegram account, never acts as you

## Project Structure

```
safeclaw/
├── src/
│   ├── index.ts                  # Entry point
│   ├── core/
│   │   ├── types.ts              # All TypeScript interfaces
│   │   ├── gateway.ts            # State machine (dormant/awake/action_pending)
│   │   ├── auth.ts               # Single-owner verification
│   │   └── config.ts             # .env config loader
│   ├── channels/telegram/
│   │   ├── client.ts             # grammy bot setup
│   │   ├── handler.ts            # Inbound message routing + auth check
│   │   ├── sender.ts             # Outbound messages with chunking
│   │   └── free-text.ts          # Natural language → tool invocation
│   ├── tools/
│   │   ├── registry.ts           # Enable/disable with status matrix
│   │   ├── browser.ts            # Simulated browser tool
│   │   ├── filesystem.ts         # Simulated filesystem tool
│   │   └── shell.ts              # Simulated shell tool
│   ├── permissions/
│   │   └── store.ts              # Approval requests with expiry
│   ├── audit/
│   │   └── logger.ts             # JSONL event logger
│   ├── commands/
│   │   ├── parser.ts             # /command parser
│   │   └── handlers.ts           # Command execution
│   └── storage/
│       └── persistence.ts        # JSON/JSONL file I/O
├── SafeClaw-Architecture-Spec.docx  # Full architecture document
├── package.json
├── tsconfig.json
└── .env.example
```

## Current State

This is a **working prototype** with simulated tool responses. The security architecture (auth, sleep/wake, tool gating, permission confirmation, audit logging) is fully functional. The simulated tools demonstrate the permission flow without risk.

### What's real:
- Gateway state machine with all transitions
- Single-owner authentication (silent drop for non-owners)
- Tool registry with runtime enable/disable
- Permission confirmation flow with expiry
- JSONL audit logging
- Telegram bot integration
- All chat commands

### What's simulated:
- Browser, filesystem, and shell tools return mock responses
- No real AI agent (LLM) connected yet

## Roadmap

- [ ] Connect real AI agent (Claude API / OpenAI API)
- [ ] WhatsApp Cloud API integration
- [ ] MCP (Model Context Protocol) server for extensible tools
- [ ] Web dashboard for visual tool management
- [ ] Multi-owner support with invite codes
- [ ] End-to-end encryption for audit logs
- [ ] Rate limiting per tool per session

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (strict mode)
- **Telegram**: [grammy](https://grammy.dev)
- **Storage**: File-based JSON + JSONL (no database)
- **Dependencies**: grammy, dotenv, uuid (minimal footprint)

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
