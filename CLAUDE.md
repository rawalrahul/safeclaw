# SafeClaw — Project Guidelines

## What This Is

SafeClaw is a **secure, privacy-first personal AI assistant** inspired by OpenClaw but redesigned from the ground up with security as the default. It connects to Telegram as its own bot identity — it never impersonates the user. The LLM backend is pluggable (Anthropic Claude or OpenAI GPT). Tools are discovered at runtime from MCP servers and from a set of built-in categories.

## Implementation Status

All four phases are complete and the project compiles cleanly with `npm run typecheck`.

| Phase | What | Status |
|-------|------|--------|
| 1 | Gateway state machine, Telegram bot, commands, audit | Done |
| 2 | Real filesystem tools, permission/confirm flow | Done |
| 3 | LLM agent (Anthropic + OpenAI), `/auth`, `/model`, conversation sessions | Done |
| 4 | MCP auto-discovery from `~/.claude/settings.json` | Done |

## Core Security Model

### 1. Sleep-by-Default
The gateway starts **dormant**. It only processes messages when the authenticated owner sends `/wake`. After 30 minutes of inactivity (configurable), it auto-sleeps. While dormant, it silently ignores everything except `/wake` from the owner.

### 2. Separate Bot Identity
SafeClaw runs as its own Telegram bot. The user chats with it like any other bot. External users don't know the bot exists.

### 3. Tools Off by Default
Every tool (builtin or MCP) is **disabled** on each wake. The owner explicitly enables tools via `/enable <tool>` or `/enable mcp:<server>` and revokes with `/disable`. Disabled tools are invisible to the LLM agent.

### 4. Permission Before Action
Even when a tool is enabled, **dangerous actions** (write, delete, execute, send) require explicit `/confirm <id>` from the owner. Safe read-only actions proceed without confirmation. Unconfirmed actions auto-deny after 5 minutes.

The danger classification for built-in tools is hardcoded. For MCP tools, `inferDangerous()` in `src/mcp/manager.ts` uses keyword heuristics (read/get/list/search → safe; create/write/delete/send → dangerous; defaults to dangerous).

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
| `/enable <tool>` | Enable a builtin tool | Yes |
| `/enable mcp:<server>` | Enable all tools for an MCP server | Yes |
| `/disable <tool>` | Disable a builtin tool | Yes |
| `/disable mcp:<server>` | Disable all tools for an MCP server | Yes |
| `/confirm <id>` | Approve a pending action | Yes |
| `/deny <id>` | Reject a pending action | Yes |
| `/status` | Show gateway state | Yes |
| `/audit [n]` | Show last N audit events | Yes |
| `/auth <provider> <key>` | Store LLM API key | No |
| `/auth status` | Show connected providers | No |
| `/auth remove <provider>` | Remove an API key | No |
| `/model <provider/model>` | Set active LLM model | No |
| `/model` | Show current model | No |
| `/help` | Show all commands | Yes |

## Architecture

```
safeclaw/
├── src/
│   ├── index.ts              # Entry point
│   ├── core/
│   │   ├── types.ts          # All TypeScript interfaces and enums
│   │   ├── gateway.ts        # State machine (dormant/awake/action_pending/shutdown)
│   │   ├── auth.ts           # Single-owner verification
│   │   └── config.ts         # .env config loader
│   ├── channels/telegram/
│   │   ├── client.ts         # grammy bot setup
│   │   ├── handler.ts        # Inbound message routing + auth check
│   │   ├── sender.ts         # Outbound messages with chunking
│   │   └── free-text.ts      # Natural language → agent runner
│   ├── providers/
│   │   ├── types.ts          # LLMProvider interface, credential types
│   │   ├── anthropic.ts      # Anthropic Claude client
│   │   ├── openai.ts         # OpenAI GPT client
│   │   ├── store.ts          # Credential persistence (~/.safeclaw/auth.json)
│   │   └── resolver.ts       # Picks active provider + model
│   ├── agent/
│   │   ├── session.ts        # Conversation history management
│   │   ├── tool-schemas.ts   # Converts ToolDefinition → LLM tool_use schemas
│   │   └── runner.ts         # LLM agent loop: safe execute / dangerous queue
│   ├── tools/
│   │   ├── registry.ts       # Enable/disable, MCP registration, status output
│   │   ├── executor.ts       # Dispatch to real impl or MCP callTool
│   │   ├── filesystem.ts     # Real fs operations (sandboxed to WORKSPACE_DIR)
│   │   ├── browser.ts        # Stub
│   │   ├── shell.ts          # Stub
│   │   ├── messaging.ts      # Stub
│   │   ├── code_exec.ts      # Stub
│   │   └── network.ts        # Stub
│   ├── mcp/
│   │   ├── config.ts         # Reads ~/.claude/settings.json mcpServers config
│   │   ├── manager.ts        # McpManager: connect, listTools, callTool, disconnect
│   │   └── index.ts          # Barrel export
│   ├── permissions/
│   │   └── store.ts          # Approval requests with 5-min expiry
│   ├── audit/
│   │   └── logger.ts         # JSONL event logger
│   ├── commands/
│   │   ├── parser.ts         # /command parser
│   │   └── handlers.ts       # Command execution and routing
│   └── storage/
│       └── persistence.ts    # JSON/JSONL file I/O helpers
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── CLAUDE.md                 # This file
```

## Key Type Decisions

- `ToolName = string` — widened from a literal union to accommodate dynamic MCP tool names
- `BUILTIN_TOOL_NAMES` — the 6 hardcoded categories; `TOOL_NAMES` is an alias for backward compat
- MCP tool registry keys use format `mcp__<server>__<tool>` (double underscore, LLM-safe)
- MCP enable/disable commands use `mcp:<server>` syntax (single colon, human-readable)
- `ActionType` includes `"mcp_call"` for MCP dispatch
- `ToolDefinition` carries `isMcp`, `mcpServer`, `mcpToolName`, `mcpSchema` optional fields

## MCP Discovery Flow

1. Owner sends `/wake`
2. Bot replies immediately (not blocked by MCP)
3. `connectMcpServers()` fires as background Promise
4. Reads `~/.claude/settings.json` → `mcpServers`; falls back to Claude Desktop config
5. For each stdio server: spawns process, calls `listTools()`, registers defs via `tools.registerMcp()`
6. HTTP/SSE servers are skipped with a console warning (not yet implemented)
7. Auth errors (401/403) are caught and skipped
8. `/tools` shows fresh data once discovery completes

## Tech Stack

- **Runtime**: Node.js 22+
- **Language**: TypeScript (strict mode)
- **Telegram**: grammy library
- **LLM**: Anthropic Claude, OpenAI GPT, or Google Gemini (pluggable via `/auth`)
- **MCP**: `@modelcontextprotocol/sdk` ^1.12.0
- **Storage**: File-based JSON + JSONL (no database)
- **Dependencies**: grammy, dotenv, uuid, @modelcontextprotocol/sdk, zod

## Development

```bash
# Install
cd safeclaw && npm install

# Configure
cp .env.example .env
# Edit .env with your Telegram bot token and owner ID

# Type check
npm run typecheck

# Run (development, with auto-reload)
npm run dev

# Run (production)
npm start
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
| LLM | Hard-coded | Pluggable (Anthropic / OpenAI / Gemini) |
| Tool extensibility | Fixed set | MCP auto-discovery |
