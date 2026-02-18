# SafeClaw — Secure Personal AI Assistant

**Sleep-by-default. Tools off by default. You hold the keys.**

SafeClaw is a privacy-first AI assistant you control from your phone via Telegram. You connect it to your own LLM API key (Anthropic Claude, OpenAI GPT, Google Gemini, or a local Ollama instance). It auto-discovers tools from any MCP servers you've configured for Claude Code.

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

---

### Check what's configured

```
/auth status
```

### Remove a stored API key

```
/auth remove anthropic
```

If you remove the active provider, SafeClaw automatically switches to another configured one.

---

### Browse and switch models

`/model` fetches the live model list directly from each provider's API — no hardcoded lists to go stale.

```
/model                          → list all models for every configured provider
/model list anthropic           → list only Anthropic models
/model <provider/model>         → switch to a specific model
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
/enable browser          → allow web browsing and URL auto-enrichment
/enable shell            → allow shell commands (includes background processes)
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
| `/sleep` | No | Return to dormant, disconnect MCP servers, kill background processes |
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
| `/tools` | List all tools (builtin + MCP + dynamic skills) with ON/OFF status |
| `/enable <tool>` | Enable a builtin tool |
| `/disable <tool>` | Disable a builtin tool |
| `/enable mcp:<server>` | Enable all tools for an MCP server |
| `/disable mcp:<server>` | Disable all tools for an MCP server |
| `/enable skill__<name>` | Enable a dynamically installed skill |
| `/disable skill__<name>` | Disable a dynamically installed skill |
| `/skills` | List prompt skills from `~/.safeclaw/prompt-skills/` |

**Builtin tools:** `browser`, `filesystem`, `shell`, `patch`

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
| `/skills` | Prompt skills status and active count |
| `/help` | All commands inline in Telegram |

---

## Customisation

### Soul File — Custom Persona

Create `~/.safeclaw/soul.md` to override SafeClaw's default persona. It is loaded on every `/wake` and appended to the system prompt, so any instructions or personality traits in it take precedence.

```markdown
# My Assistant

You are an expert DevOps assistant. Keep responses extremely terse.
Always suggest the simplest possible solution.
Prefer shell one-liners over multi-step processes.
```

The file is optional — delete it to revert to the default persona.

### Prompt Skills — Teach the LLM CLI Patterns

Drop `.md` files into `~/.safeclaw/prompt-skills/` to teach SafeClaw how to use specific CLI tools without writing any code. On each `/wake`, SafeClaw scans this directory, checks whether required binaries are present on your PATH, and injects the content of active skills into the system prompt.

**Example: `~/.safeclaw/prompt-skills/weather.md`**

```markdown
---
title: Weather
bins: []
---

## Checking the weather

To look up current weather, run:

    curl wttr.in/London?format=3

Replace "London" with any city name. No API key needed.
For a full forecast: `curl wttr.in/London`
```

**Example with bin requirements: `~/.safeclaw/prompt-skills/github.md`**

```markdown
---
title: GitHub CLI
bins: [gh]
---

## Using the GitHub CLI

Always prefer `gh` for GitHub operations:

- List open PRs: `gh pr list`
- View PR checks: `gh pr checks <number>`
- View failed run logs: `gh run view --log-failed`
- Create issue: `gh issue create --title "..." --body "..."`
- Search code: `gh api search/code?q=...`
```

This skill only activates if `gh` is installed on PATH. Run `/skills` to see which are active.

**Frontmatter options:**

```yaml
---
title: My Tool         # displayed in /skills — defaults to filename
bins: [git, curl]      # ALL must be on PATH for skill to activate
anyBins: [jq, python3] # AT LEAST ONE must be on PATH
---
```

---

## Background Process Execution

When the `shell` tool is enabled, the LLM can run commands in the background — useful for long-running tasks like builds, installs, or servers.

```
You:  run npm install in the background

Bot:  Action pending approval:
        exec_shell_bg: npm install
      /confirm a1b2c3d4

You:  /confirm a1b2c3d4
Bot:  Background process started.
      Session ID: f3a9b2c1
      Use process_poll with session_id="f3a9b2c1" to check output.

You:  check on the npm install
Bot:  [calls process_poll f3a9b2c1 — returns accumulated output]
      added 842 packages in 23s
      [Process still running]
```

**Background process actions** (all via the `shell` tool):

| Action | Safe? | Description |
|--------|-------|-------------|
| `exec_shell_bg` | Requires `/confirm` | Spawn a command, return session ID immediately |
| `process_poll` | Safe (no confirm) | Read accumulated output from a session |
| `process_list` | Safe (no confirm) | List all active/recent background sessions |
| `process_write` | Requires `/confirm` | Write to stdin of a running process |
| `process_kill` | Requires `/confirm` | Send SIGTERM to a running process |

Sessions are automatically cleaned up 30 minutes after the process exits. All running processes are terminated on `/sleep`, `/kill`, or auto-sleep.

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

      ⚠️  This skill performs potentially dangerous operations.

      Proposed code:
      ```
      export const skill = {
        name: "pdf_create",
        ...
        async execute(params) { ... }
      };
      ```

      /confirm a1b2c3d4  →  install skill
      /deny a1b2c3d4     →  reject proposal

You:  /confirm a1b2c3d4

Bot:  Skill "pdf_create" has been installed and is now active.
      [Agent continues and creates the PDF...]
```

### Security

- **Every skill install requires `/confirm`** — same as any other dangerous action
- **Full code is shown before you approve** — never a black box
- **Skills run with full Node.js access** — treat them like running a shell script you wrote yourself

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
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  }
}
```

> **Note:** HTTP/SSE MCP servers are not yet supported. Only `stdio` servers (those with a `command` field) are connected.

---

## URL Auto-Enrichment

When the `browser` tool is enabled and your message contains a URL, SafeClaw fetches it automatically before sending to the LLM — the LLM sees the page content as inline context without needing an explicit tool call.

```
You:  summarise this article https://example.com/article
Bot:  [fetches the URL silently, LLM sees the content, summarises it]
```

Up to 3 URLs per message are fetched, each capped at 6 KB of extracted text. If the browser tool is disabled, URLs are passed to the LLM as-is.

---

## Context Management

### Context window guard

Tool results larger than 8 KB are automatically truncated before being added to the conversation. This prevents a single large file read or web fetch from consuming the entire context window.

### Auto-compaction

When the conversation history grows beyond ~60 000 tokens, SafeClaw calls the LLM to summarise the oldest 20 messages and replaces them with a compact summary block. You'll see:

```
📦 Conversation compacted to fit context window.
```

This lets conversations run indefinitely without hitting the model's context limit.

### Message debouncing

If you send multiple messages in quick succession (within 500 ms), they are merged into a single agent run. This prevents duplicate parallel LLM calls from burst typing.

---

## Security Model

- **Sleep-by-default**: Gateway starts dormant and ignores all messages except `/wake` from the owner
- **Single owner**: Only your Telegram user ID is authorized. Everyone else is silently ignored
- **Tools off by default**: All tools — builtin and MCP — are disabled on every wake
- **Confirm before dangerous action**: Write, delete, execute, send, and background-spawn operations require `/confirm`
- **Auto-sleep**: Inactivity timeout (default 30 min) returns to dormant automatically; kills background processes
- **Full audit trail**: Every event logged to `~/.safeclaw/audit.jsonl`
- **Separate identity**: The bot is its own Telegram account, never acts as you
- **MCP isolation**: Each MCP server runs as a subprocess; crashing servers don't crash SafeClaw
- **Workspace sandboxing**: Filesystem tool is restricted to `WORKSPACE_DIR` — no escape via `../`
- **Skill review**: Dynamically proposed skills are always shown in full before installation

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
│   │   ├── handler.ts            # Inbound routing, auth check, 500ms debounce
│   │   ├── sender.ts             # Outbound with message chunking for long replies
│   │   └── free-text.ts          # URL enrichment + LLM agent routing
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
│   │   ├── session.ts            # Conversation history + token estimation
│   │   ├── tool-schemas.ts       # Builtin + background process tool schemas
│   │   └── runner.ts             # LLM loop: dynamic system prompt, safe execute,
│   │                             #   dangerous queue, context guard, auto-compaction
│   ├── tools/
│   │   ├── registry.ts           # Tool map: enable/disable, MCP register/clear
│   │   ├── executor.ts           # Dispatches to real impl or MCP callTool
│   │   ├── filesystem.ts         # Real fs: read, list, write, delete (sandboxed)
│   │   ├── browser.ts            # Real: fetch + Readability extraction
│   │   ├── shell.ts              # Real: child_process exec with 30s timeout
│   │   ├── patch.ts              # Real: apply Add/Update/Delete/Move patches
│   │   └── process-registry.ts  # Background process sessions + TTL sweeper
│   ├── skills/
│   │   ├── dynamic.ts            # DynamicSkill interface + .mjs file loader
│   │   ├── manager.ts            # SkillsManager: install, load, persist skills
│   │   └── prompt-skills.ts      # SKILL.md loader: bin-check + system prompt injection
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

### User data directories (`~/.safeclaw/`)

```
~/.safeclaw/
├── auth.json                     # Stored API keys (encrypted at rest via OS perms)
├── audit.jsonl                   # Append-only audit log
├── soul.md                       # Optional custom persona (injected on wake)
├── prompt-skills/                # SKILL.md files — teach LLM CLI patterns
│   ├── weather.md
│   ├── github.md
│   └── ...
└── skills/                       # Dynamically installed JS skills
    ├── pdf_create.mjs
    └── ...
```

---

## What's Implemented

All features are fully implemented — there are no stubs.

| Feature | Status |
|---------|--------|
| Gateway state machine (dormant/awake/action_pending/shutdown) | ✅ |
| Single-owner auth with silent drop | ✅ |
| Runtime tool enable/disable | ✅ |
| `/confirm` dangerous action flow with 5-min expiry | ✅ |
| JSONL audit log | ✅ |
| Telegram bot (grammy) | ✅ |
| LLM agent — Anthropic, OpenAI, Gemini, Ollama | ✅ |
| Live model listing from provider APIs | ✅ |
| Persistent API key storage | ✅ |
| Real filesystem tool (sandboxed to `WORKSPACE_DIR`) | ✅ |
| Real browser tool (fetch + Readability extraction) | ✅ |
| Real shell tool (`child_process`, 30s timeout) | ✅ |
| Apply-patch tool (Add/Update/Delete/Move) | ✅ |
| MCP auto-discovery from `~/.claude/settings.json` | ✅ |
| Self-extending dynamic skills (LLM proposes, owner approves) | ✅ |
| Soul file — custom persona from `~/.safeclaw/soul.md` | ✅ |
| Prompt skills — SKILL.md files injected into system prompt | ✅ |
| URL auto-enrichment — auto-fetch URLs in messages | ✅ |
| Message debouncing — merge burst messages | ✅ |
| Context window guard — truncate large tool results | ✅ |
| Auto-compaction — LLM summarises old history | ✅ |
| Background process execution — `exec_shell_bg` + poll/write/kill | ✅ |

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
| Browser | `@mozilla/readability` + `linkedom` |
| MCP | `@modelcontextprotocol/sdk` ^1.12.0 |
| Storage | File-based JSON + JSONL (no database) |
| Dev runner | `tsx` (TypeScript execute, no build step needed) |

---

## Roadmap

- [x] Gateway state machine, Telegram integration, commands, audit
- [x] Real filesystem tools with path sandboxing
- [x] LLM agent — Anthropic, OpenAI, Gemini, Ollama — with tool calling
- [x] Live model listing from provider APIs
- [x] MCP tool auto-discovery from `~/.claude/settings.json`
- [x] Self-extending skills — agent proposes and installs new capabilities at runtime
- [x] Real browser tool (fetch + Readability)
- [x] Real shell execution (with timeout and output limits)
- [x] Apply-patch tool for code editing
- [x] Soul file — custom persona without code changes
- [x] Prompt skills — SKILL.md files teach CLI patterns
- [x] URL auto-enrichment in messages
- [x] Message debouncing
- [x] Context window guard
- [x] Auto-compaction of conversation history
- [x] Background process execution with poll/write/kill
- [ ] HTTP/SSE MCP server support
- [ ] WhatsApp Cloud API integration
- [ ] Web dashboard for visual tool management
- [ ] Multi-owner support with invite codes
- [ ] Semantic memory (SQLite + vector search across sessions)

---

## Contributing

Contributions welcome! Please open an issue first to discuss what you'd like to change. The architecture is documented in `CLAUDE.md`.

## License

[MIT](LICENSE)
