# SafeClaw — Secure Personal AI Assistant

**Sleep-by-default. Tools off by default. You hold the keys.**

SafeClaw is a privacy-first AI assistant you control from your phone via Telegram. You connect it to your own LLM API key (Anthropic Claude, OpenAI GPT, or Google Gemini). It auto-discovers tools from any MCP servers you've configured for Claude Code.

Unlike always-on AI gateways, SafeClaw inverts the defaults:

| Problem with most AI gateways | SafeClaw's answer |
|-------------------------------|-------------------|
| Bot hijacks your messaging account | **Own identity** — SafeClaw is its own Telegram bot, never impersonates you |
| Always-on with a large attack surface | **Dormant by default** — only wakes when you send `/wake` |
| Static tool permissions set in config | **Runtime toggle** — `/enable browser`, `/disable shell`, on the fly |
| Dangerous actions execute immediately | **Explicit approval** — every write, delete, execute requires `/confirm` |
| Unknown senders get error responses | **Silent drop** — non-owners receive zero response, zero acknowledgment |
| LLM tools locked to a fixed list | **MCP auto-discovery** — picks up any MCP server from your Claude settings |

---

## Prerequisites

- **Node.js 22+** (`node --version` to check)
- A **Telegram account** (to talk to the bot)
- An API key from at least one LLM provider, **or** a locally running Ollama instance:
  - **Anthropic** — [console.anthropic.com](https://console.anthropic.com) → API Keys
  - **OpenAI** — [platform.openai.com](https://platform.openai.com) → API Keys
  - **Google Gemini** — [aistudio.google.com](https://aistudio.google.com) → Get API Key *(free tier available)*
  - **Ollama** — free, runs entirely on your machine, no API key required (see below)

---

## Step 1 — Create a Telegram Bot

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**
2. Send `/newbot` and follow the prompts (pick any name and username)
3. Copy the **bot token** — looks like `7412345678:AAFz...`

> Keep this token private. Anyone with it can control your bot.

---

## Step 2 — Find Your Telegram User ID

1. Message **[@userinfobot](https://t.me/userinfobot)** on Telegram
2. It replies with your numeric user ID — looks like `123456789`

This ID is how SafeClaw knows you're the owner. Every message from any other ID is silently dropped.

---

## Step 3 — Install SafeClaw

```bash
git clone https://github.com/yourname/safeclaw.git
cd safeclaw
npm install
```

---

## Step 4 — Configure

```bash
cp .env.example .env
```

Edit `.env`:

```env
TELEGRAM_BOT_TOKEN=7412345678:AAFz...       # from BotFather
OWNER_TELEGRAM_ID=123456789                 # your numeric Telegram ID
INACTIVITY_TIMEOUT_MINUTES=30               # optional, default 30
WORKSPACE_DIR=/home/you/safeclaw-workspace  # optional, default ~/safeclaw-workspace
```

> `WORKSPACE_DIR` is the only directory SafeClaw's filesystem tool can read or write. It is sandboxed — paths that try to escape it (e.g. `../../etc/passwd`) are rejected.

---

## Step 5 — Run

```bash
# Development (auto-reloads on file changes)
npm run dev

# Production
npm start
```

You should see:

```
┌─────────────────────────────────────┐
│   SafeClaw — Secure AI Assistant     │
│   Sleep-by-default. You hold the keys│
└─────────────────────────────────────┘
[telegram] Bot online: @YourBotName
[telegram] Send /wake from your Telegram to activate
Security status:
  ✓ Gateway: DORMANT (ignoring all messages except /wake)
  ✓ Tools: ALL DISABLED
  ✓ Authentication: single-owner (Telegram ID)
  ✓ Owner: 123456789
```

---

## Step 6 — Connect to an LLM

Open Telegram, find your bot, and store your API key. **These commands work even while the gateway is dormant** — you don't need to `/wake` first.

### Anthropic Claude

```
/auth anthropic sk-ant-api03-...
```

Default model: `claude-sonnet-4-5-20250929`

### OpenAI GPT

```
/auth openai sk-proj-...
```

Default model: `gpt-4o`

### Google Gemini (free tier available)

```
/auth gemini AIza...
```

Default model: `gemini-2.0-flash`. Get a free key at [aistudio.google.com](https://aistudio.google.com) — no billing required.

### Ollama (local LLM — no API key needed)

Ollama lets you run open-source LLMs entirely on your own machine. No cloud account, no usage costs, full privacy.

#### Step A — Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows
# Download the installer from https://ollama.com/download
```

#### Step B — Pull a model

```bash
ollama pull llama3.2          # recommended — fast, supports tool calling
ollama pull qwen2.5           # strong alternative with tool calling
ollama pull mistral-nemo      # good balance of speed and quality
```

> **Tool calling note:** SafeClaw's LLM agent relies on structured tool calling. Use models known to support it: `llama3.1`, `llama3.2`, `qwen2.5`, `mistral-nemo`. General chat models (`phi3`, `gemma`, etc.) may respond without tool calls even when tools are enabled.

#### Step C — Start the Ollama server

```bash
ollama serve
```

Ollama binds to `http://localhost:11434` by default. Leave this running while SafeClaw is active.

#### Step D — Register Ollama with SafeClaw

In Telegram, tell SafeClaw where Ollama is running. **This works even while the gateway is dormant.**

```
/auth ollama local
```

`local` is a shorthand for `http://localhost:11434`. If Ollama is on another machine or a different port, pass the full URL:

```
/auth ollama http://192.168.1.50:11434
```

#### Step E — Select a model

```
/model ollama/llama3.2
```

Or list all models currently installed in your Ollama instance:

```
/model list ollama
```

Example output:
```
Active: ollama / llama3.2

ollama — 3 model(s):
  ▶ llama3.2
    qwen2.5
    mistral-nemo

Switch with: /model <provider>/<model-id>
```

#### Running Ollama on a remote machine / GPU server

If you have a machine with a GPU, you can run Ollama there and point SafeClaw at it:

```bash
# On the GPU server — bind to all interfaces
OLLAMA_HOST=0.0.0.0 ollama serve
```

```
# In Telegram
/auth ollama http://<server-ip>:11434
/model ollama/llama3.3
```

---

### Check what's configured

```
/auth status
```

Output example:
```
Auth Status:
  Active: anthropic / claude-sonnet-4-5-20250929

  Providers:
    anthropic: sk-ant-ap...a1b2  (active)
    openai: not configured
    gemini: AIzaSy...x9y8
    ollama: http://localhost:11434
```

### Remove a stored API key

```
/auth remove anthropic
/auth remove openai
/auth remove gemini
/auth remove ollama
```

If you remove the active provider, SafeClaw automatically switches to another configured one. If it was the last key, the active provider is cleared and you'll need to add a new one before the LLM agent can respond.

---

### Browse and switch models

`/model` fetches the live model list directly from each provider's API — no hardcoded lists to go stale.

```
/model                          → list all models for every configured provider
/model list anthropic           → list only Anthropic models
/model list openai              → list only OpenAI models
/model list gemini              → list only Gemini models
```

Example output:
```
Active: anthropic / claude-sonnet-4-5-20250929

anthropic — 6 model(s):
  ▶ claude-sonnet-4-5-20250929  (Claude Sonnet 4.5)
    claude-opus-4-6  (Claude Opus 4.6)
    claude-haiku-4-5-20251001  (Claude Haiku 4.5)
    ...

gemini — 12 model(s):
    gemini-2.0-flash  (Gemini 2.0 Flash)
    gemini-1.5-pro  (Gemini 1.5 Pro)
    ...

Switch with: /model <provider>/<model-id>
```

To switch:
```
/model anthropic/claude-opus-4-6
/model openai/gpt-4o-mini
/model gemini/gemini-1.5-pro
```

Credentials are stored in `~/.safeclaw/auth.json`. They persist across restarts.

---

## Step 7 — Wake Up and Go

```
/wake
```

The bot replies with available commands and the auto-sleep timeout. Now you can:

```
/enable filesystem       → allow file reads and writes
/enable browser          → allow web browsing
/tools                   → see everything and its ON/OFF status
```

Then just talk naturally:

```
You:  what files are in my workspace?
Bot:  [lists files]

You:  write a Python script that fetches the Hacker News front page
Bot:  Action pending approval:
        Tool: filesystem/write_file
        Details: write_file: hn_fetch.py (312 chars)
        Expires in: 300s
      Reply /confirm a1b2c3d4 or /deny a1b2c3d4

You:  /confirm a1b2c3d4
Bot:  Approved. [LLM follow-up: "Done! I've written hn_fetch.py ..."]
```

---

## All Commands

### Lifecycle

| Command | Works dormant? | Description |
|---------|---------------|-------------|
| `/wake` | Yes | Wake the gateway |
| `/sleep` | No | Return to dormant, disconnect MCP servers |
| `/kill` | No | Emergency shutdown, stops the process |

### LLM Provider Setup

| Command | Works dormant? | Description |
|---------|---------------|-------------|
| `/auth <provider> <api-key>` | Yes | Store API key (`anthropic`, `openai`, `gemini`) or Ollama URL (`/auth ollama local`) |
| `/auth status` | Yes | Show all configured providers and the active one |
| `/auth remove <provider>` | Yes | Delete a stored API key |
| `/model` | Yes | List all available models fetched live from provider APIs |
| `/model list <provider>` | Yes | List models for one specific provider |
| `/model <provider/model>` | Yes | Switch to a specific model |

### Tools

| Command | Description |
|---------|-------------|
| `/tools` | List all tools (builtin + MCP) with ON/OFF status |
| `/enable <tool>` | Enable a builtin tool |
| `/disable <tool>` | Disable a builtin tool |
| `/enable mcp:<server>` | Enable all tools for an MCP server |
| `/disable mcp:<server>` | Disable all tools for an MCP server |

**Builtin tools:** `browser`, `filesystem`, `shell`, `code_exec`, `network`, `messaging`

### Permissions

| Command | Description |
|---------|-------------|
| `/confirm <id>` | Approve a pending dangerous action |
| `/deny <id>` | Reject a pending action |
| `/confirm` | List all pending approvals with their IDs |

### Info

| Command | Description |
|---------|-------------|
| `/status` | Gateway state, uptime, idle time, enabled tools |
| `/audit [n]` | Last N audit log events (default 10) |
| `/help` | All commands inline in Telegram |

---

## Self-Extending Skills

SafeClaw can detect when it lacks a capability and propose new skills at runtime — without a restart.

### How it works

When you give the agent a task it can't complete with its current tools (e.g. "create a PDF report"), it automatically:

1. Recognises the capability gap
2. Generates a working JavaScript implementation
3. Sends you a proposal with a full code preview for review
4. Waits for your `/confirm` before installing anything

On approval, the skill is written to `~/.safeclaw/skills/<name>.mjs`, dynamically imported, and immediately available. It persists across restarts.

### Example session

```
You:  create a PDF summary of my workspace notes

Bot:  🔧 Skill Proposal: pdf_create
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━
      Description: Create PDF documents from text content
      Needed for: Generating a PDF summary of workspace notes

      ⚠️  This skill performs potentially dangerous operations (file writes, network calls, etc.).

      Proposed code:
      ```
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";

      export const skill = {
        name: "pdf_create",
        description: "Create PDF documents from text content",
        dangerous: true,
        parameters: {
          type: "object",
          properties: {
            filename: { type: "string" },
            content: { type: "string" }
          },
          required: ["filename", "content"]
        },
        async execute(params) {
          // Simple text file fallback if pdfkit not available
          const path = join(process.env.WORKSPACE_DIR || ".", params.filename);
          writeFileSync(path, params.content, "utf8");
          return `Saved to ${params.filename}`;
        }
      };
      ```

      ⚠️  This code will run inside the SafeClaw process with full Node.js access.
      Review it carefully before approving.

      Expires in: 300s

      /confirm a1b2c3d4  →  install skill
      /deny a1b2c3d4     →  reject proposal

You:  /confirm a1b2c3d4

Bot:  Approved.
      Skill "pdf_create" has been installed and is now active.
      [Agent continues and creates the PDF...]
```

### Skill storage

Skills live in `~/.safeclaw/skills/` as ES module JavaScript files (`.mjs`). They load on every `/wake`. You can inspect or delete them directly:

```bash
ls ~/.safeclaw/skills/
cat ~/.safeclaw/skills/pdf_create.mjs
rm ~/.safeclaw/skills/pdf_create.mjs   # remove a skill permanently
```

### Skill tool names

Installed skills appear in `/tools` under **Dynamic Skills** and are referenced with a `skill__` prefix:

```
/tools
→  Dynamic Skills (installed by agent):
     OFF  skill__pdf_create — Create PDF documents from text content ⚠️

/enable skill__pdf_create
/disable skill__pdf_create
```

### Security

- **Every skill install requires `/confirm`** — same as any other dangerous action
- **Full code is shown before you approve** — never a black box
- **Skills run with full Node.js access** — treat them like running a shell script you wrote yourself
- **Skills are disabled by default after install** — the agent auto-enables the freshly installed skill for the current session, but after a `/sleep` + `/wake` cycle you control whether it's enabled via `/enable skill__<name>`

---

## MCP Tool Auto-Discovery

SafeClaw reads the MCP server configuration from your Claude Code settings and automatically discovers all tools from them on every `/wake`.

### How it works

1. You send `/wake`
2. SafeClaw immediately replies (it doesn't block on MCP discovery)
3. In the background it reads `~/.claude/settings.json` → `mcpServers`
4. For each configured server it connects, calls `listTools()`, and registers the results
5. Run `/tools` a moment later to see the discovered tools grouped by server
6. Tools are classified as safe or dangerous by keyword heuristics (read/get/list → safe; write/delete/create/send → dangerous)

### Enabling MCP tools

```
/enable mcp:my-server      → enable all tools for "my-server"
/disable mcp:my-server     → disable all tools for "my-server"
/tools                     → see full list including MCP tools
```

### Example `~/.claude/settings.json`

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

Environment variable placeholders like `${GITHUB_TOKEN}` are resolved from the process environment. Servers that fail to connect (wrong command, network error, 401/403 auth) are skipped with a console warning — they don't crash the bot.

> **Note:** HTTP/SSE MCP servers are not yet supported. Only `stdio` servers (those with a `command` field) are connected.

---

## A Realistic Session

```
[Phone]

You:   /wake
Bot:   Gateway awake. All tools are disabled by default.
       Auto-sleep in 30 minutes of inactivity.
       Use /tools to see tools, /enable <tool> to activate one.

You:   /tools
Bot:   Tool Registry:
         OFF  browser — Web browsing and search
         OFF  filesystem — Read, write, and delete files
         OFF  shell — Execute shell commands
         OFF  code_exec — Run code snippets
         OFF  network — HTTP requests and API calls
         OFF  messaging — Send messages to contacts

       MCP Servers:
         github:
           OFF  mcp__github__search_repositories — Search GitHub repositories
           OFF  mcp__github__create_issue — Create a GitHub issue
           OFF  mcp__github__get_file_contents — Get file contents from a repo

You:   /enable filesystem
Bot:   filesystem is now ENABLED.
       Dangerous actions will still require /confirm before executing.

You:   /enable mcp:github
Bot:   Enabled 3 tool(s) for MCP server "github".

You:   search for typescript MCP server examples on GitHub
Bot:   Found 12 repositories matching "typescript MCP server":
       1. modelcontextprotocol/typescript-sdk — ...
       2. ...

You:   write those results to a file called mcp-examples.md
Bot:   Action pending approval:
         Details: write_file: mcp-examples.md (1.4 KB)
         Expires in: 300s
       Reply /confirm 9f2e1a8b or /deny 9f2e1a8b

You:   /confirm 9f2e1a8b
Bot:   Approved.
       Done! I've saved the search results to mcp-examples.md in your workspace.

You:   /sleep
Bot:   Gateway dormant. Goodnight.
```

---

## Security Model

- **Sleep-by-default**: Gateway starts dormant and ignores all messages except `/wake` from the owner
- **Single owner**: Only your Telegram user ID is authorized. Everyone else is silently ignored
- **Tools off by default**: All tools — builtin and MCP — are disabled on every wake
- **Confirm before dangerous action**: Write, delete, execute, send, and create operations require `/confirm`
- **Auto-sleep**: Inactivity timeout (default 30 min) returns to dormant automatically
- **Full audit trail**: Every event logged to `~/.safeclaw/audit.jsonl`
- **Separate identity**: The bot is its own Telegram account, never acts as you
- **MCP isolation**: Each MCP server runs as a subprocess; crashing servers don't crash SafeClaw
- **Workspace sandboxing**: Filesystem tool is restricted to `WORKSPACE_DIR` — no escape via `../`

---

## Project Structure

```
safeclaw/
├── src/
│   ├── index.ts                  # Entry point and startup
│   ├── core/
│   │   ├── types.ts              # All TypeScript interfaces and enums
│   │   ├── gateway.ts            # State machine (dormant/awake/action_pending)
│   │   ├── auth.ts               # Single-owner Telegram ID check
│   │   └── config.ts             # .env loader and config validation
│   ├── channels/telegram/
│   │   ├── client.ts             # grammy bot setup
│   │   ├── handler.ts            # Inbound routing, auth check, command dispatch
│   │   ├── sender.ts             # Outbound with message chunking for long replies
│   │   └── free-text.ts          # Routes plain messages to LLM agent
│   ├── providers/
│   │   ├── types.ts              # LLMProvider interface, ProviderName, defaults
│   │   ├── anthropic.ts          # Anthropic Claude API client
│   │   ├── openai.ts             # OpenAI API client
│   │   ├── gemini.ts             # Google Gemini API client
│   │   ├── ollama.ts             # Ollama local LLM client (OpenAI-compatible)
│   │   ├── models.ts             # Live model listing from provider APIs
│   │   ├── store.ts              # Persists API keys to ~/.safeclaw/auth.json
│   │   └── resolver.ts           # Picks the active provider and model
│   ├── agent/
│   │   ├── session.ts            # Conversation history (trimmed to avoid token limits)
│   │   ├── tool-schemas.ts       # Builtin tool schemas + MCP schema passthrough
│   │   └── runner.ts             # LLM loop: execute safe tools, queue dangerous ones
│   ├── tools/
│   │   ├── registry.ts           # Tool map: enable/disable, MCP register/clear
│   │   ├── executor.ts           # Dispatches to real impl or MCP callTool
│   │   ├── filesystem.ts         # Real fs: read, list, write, delete (sandboxed)
│   │   ├── browser.ts            # Stub (simulated response)
│   │   ├── shell.ts              # Stub
│   │   ├── messaging.ts          # Stub
│   │   ├── code_exec.ts          # Stub
│   │   └── network.ts            # Stub
│   ├── skills/
│   │   ├── dynamic.ts            # DynamicSkill interface + .mjs file loader
│   │   └── manager.ts            # SkillsManager: install, load, persist skills
│   ├── mcp/
│   │   ├── config.ts             # Reads ~/.claude/settings.json mcpServers block
│   │   ├── manager.ts            # Connect/discover/call/disconnect MCP servers
│   │   └── index.ts              # Barrel export
│   ├── permissions/
│   │   └── store.ts              # Pending approval store with 5-min expiry
│   ├── audit/
│   │   └── logger.ts             # JSONL event logger to ~/.safeclaw/audit.jsonl
│   ├── commands/
│   │   ├── parser.ts             # /command tokenizer
│   │   └── handlers.ts           # Handler for each command
│   └── storage/
│       └── persistence.ts        # JSON/JSONL read-write helpers
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── CLAUDE.md                     # Architecture and dev guidelines
```

---

## What's Real vs. Simulated

### Real (fully implemented)
- Gateway state machine with all transitions (dormant / awake / action_pending / shutdown)
- Single-owner authentication with silent drop for unauthorized senders
- Tool registry with runtime enable/disable
- Permission confirmation flow with 5-minute expiry
- JSONL audit logging to `~/.safeclaw/audit.jsonl`
- Telegram bot integration (grammy)
- LLM agent — **Anthropic Claude, OpenAI GPT, Google Gemini, and Ollama (local)** with real tool_use/function calling
- Live model listing fetched from provider APIs (`/model`)
- Persistent API key storage in `~/.safeclaw/auth.json`
- **Real filesystem** — read, write, list, delete (sandboxed to `WORKSPACE_DIR`)
- **MCP auto-discovery** — stdio servers from `~/.claude/settings.json`
- **Self-extending skills** — agent proposes new capabilities, owner approves, skills are dynamically installed and loaded without restart
- Conversation sessions with history trimming

### Simulated (stub responses)
- `browser` — returns mock search results
- `shell` — returns mock command output
- `messaging` — pretends to send a message
- `code_exec` — returns mock execution result
- `network` — returns mock HTTP response

These stubs demonstrate the full permission flow safely. Replacing them with real implementations is straightforward — see the pattern in `src/tools/filesystem.ts`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Language | TypeScript 5 (strict mode) |
| Telegram | [grammy](https://grammy.dev) |
| LLM: Anthropic | Anthropic Messages API (raw fetch) |
| LLM: OpenAI | OpenAI Chat Completions API (raw fetch) |
| LLM: Gemini | Google Generative Language API (raw fetch) |
| LLM: Ollama | Ollama OpenAI-compatible API (local, raw fetch) |
| MCP | `@modelcontextprotocol/sdk` ^1.12.0 |
| Storage | File-based JSON + JSONL (no database) |
| Dev runner | `tsx` (TypeScript execute, no build step needed) |

---

## Roadmap

- [x] Gateway state machine, Telegram integration, commands, audit
- [x] Real filesystem tools with path sandboxing
- [x] LLM agent — Anthropic Claude, OpenAI GPT, Google Gemini, and Ollama (local) — with tool calling
- [x] Live model listing fetched from provider APIs (+ local listing for Ollama)
- [x] MCP tool auto-discovery from `~/.claude/settings.json`
- [x] Self-extending skills — agent proposes and installs new capabilities at runtime
- [ ] Real browser tool (Playwright / Puppeteer)
- [ ] Real shell execution (with timeout and output limits)
- [ ] HTTP/SSE MCP server support
- [ ] WhatsApp Cloud API integration
- [ ] Web dashboard for visual tool management
- [ ] Multi-owner support with invite codes
- [ ] Rate limiting per tool per session

---

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change. The architecture is documented in `CLAUDE.md`.

## License

[MIT](LICENSE)
