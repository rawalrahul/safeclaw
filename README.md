# SafeClaw — Secure Personal AI Assistant

**Sleep-by-default. Tools off by default. You hold the keys.**

SafeClaw is a privacy-first AI assistant you control from your phone via Telegram. You connect it to your own LLM API key (Anthropic Claude, OpenAI GPT, Google Gemini, or a local Ollama instance). It auto-discovers tools from any MCP servers you've configured, adapts to your available hardware, and orchestrates multi-step tasks using a manager–worker–reviewer agent pipeline — all without any telemetry, cloud accounts, or third-party data handling.

Unlike always-on AI gateways, SafeClaw inverts the defaults:

| Problem with most AI gateways | SafeClaw's answer |
|-------------------------------|-------------------|
| Bot hijacks your messaging account | **Own identity** — SafeClaw is its own Telegram bot |
| Always-on with a large attack surface | **Dormant by default** — only wakes on `/wake` |
| Static tool permissions set in config | **Runtime toggle** — `/enable browser`, `/disable shell`, on the fly |
| Dangerous actions execute immediately | **Explicit approval** — every write, delete, execute requires `/confirm` |
| Unknown senders get error responses | **Silent drop** — non-owners receive zero response, zero acknowledgment |
| LLM can read your API keys and `.env` | **SecretGuard** — protected paths blocked at the tool layer, never reach the LLM |
| Agent ignores hardware constraints | **Infra-aware** — probes CPU/RAM/GPU/Ollama on wake, calibrates worker count |
| One LLM handles everything linearly | **Multi-agent** — manager decomposes complex tasks into parallel/sequential workers |

---

## Prerequisites

- **Node.js 22+** (`node --version` to check)
- A **Telegram account** (to talk to the bot)
- At least one of:
  - **Anthropic** API key — [console.anthropic.com](https://console.anthropic.com) → API Keys
  - **OpenAI** API key — [platform.openai.com](https://platform.openai.com) → API Keys
  - **Google Gemini** API key — [aistudio.google.com](https://aistudio.google.com) → Get API Key *(free tier available)*
  - **Ollama** — free, runs entirely on your machine, no API key required (see below)

---

## Step 1 — Create a Telegram Bot

1. Open Telegram and message **[@BotFather](https://t.me/BotFather)**
2. Send `/newbot` and follow the prompts
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

> `WORKSPACE_DIR` is the only directory SafeClaw's filesystem tool can read or write. Paths that try to escape it (e.g. `../../etc/passwd`) are rejected. `.env` files and `~/.safeclaw/*.json` are additionally blocked by SecretGuard even inside the workspace.

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

Ollama lets you run open-source LLMs entirely on your own machine. No cloud, no costs, full privacy.

#### Step A — Install Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download from https://ollama.com/download
```

#### Step B — Pull a tool-capable model

```bash
ollama pull llama3.2          # recommended — fast, supports tool calling
ollama pull qwen2.5           # strong alternative, good with structured output
ollama pull mistral-nemo      # good balance of speed and quality
```

> **Tool calling requirement:** SafeClaw needs models with native tool-calling support. Use `llama3.1`, `llama3.2`, `qwen2.5`, or `mistral-nemo`. SafeClaw uses Ollama's **native `/api/chat`** endpoint (not the OpenAI-compat layer), with schema normalisation to strip fields that confuse small models.

#### Step C — Start Ollama

```bash
ollama serve
# Binds to http://localhost:11434 by default
```

#### Step D — Register with SafeClaw

```
/auth ollama local
```

`local` is shorthand for `http://localhost:11434`. For a remote Ollama instance:

```
/auth ollama http://192.168.1.50:11434
```

#### Step E — Select a model

```
/model ollama/llama3.2
```

### Check what's configured

```
/auth status
```

### Browse and switch models

```
/model                          → list all models for every configured provider
/model list anthropic           → list only Anthropic models
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

On wake, SafeClaw:
1. Switches to `AWAKE` state — all tools disabled by default
2. Loads your `soul.md` persona and prompt skills (background)
3. Probes system resources: CPU cores, RAM, GPU (nvidia-smi), Ollama models (background)
4. Connects to all configured MCP servers and discovers their tools (background)
5. Starts the 30-minute inactivity timer

```
/enable filesystem       → allow file reads and writes
/enable browser          → allow web browsing and URL auto-enrichment
/enable shell            → allow shell commands (includes background processes)
/tools                   → see everything and its ON/OFF status
/status                  → gateway state + probed hardware info
```

Then talk naturally:

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
Bot:  Approved. Done! I've written hn_fetch.py ...
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
| `/auth <provider> <key>` | Yes | Store API key (`anthropic`, `openai`, `gemini`) or Ollama URL (`/auth ollama local`) |
| `/auth status` | Yes | Show all configured providers and the active one |
| `/auth remove <provider>` | Yes | Delete a stored API key |
| `/model` | Yes | List all available models fetched live from provider APIs |
| `/model list <provider>` | Yes | List models for one specific provider |
| `/model <provider/model>` | Yes | Switch to a specific model |

### Tools

| Command | Description |
|---------|-------------|
| `/tools` | List all tools (builtin + MCP + dynamic skills) with ON/OFF status |
| `/enable <tool>` | Enable a builtin tool (`filesystem`, `browser`, `shell`, `patch`, `memory`) |
| `/disable <tool>` | Disable a builtin tool |
| `/enable mcp:<server>` | Enable all tools for an MCP server |
| `/disable mcp:<server>` | Disable all tools for an MCP server |
| `/enable skill__<name>` | Enable a dynamically installed skill |
| `/disable skill__<name>` | Disable a dynamically installed skill |
| `/skills` | List prompt skills from `~/.safeclaw/prompt-skills/` |

### Permissions

| Command | Description |
|---------|-------------|
| `/confirm <id>` | Approve a pending dangerous action |
| `/deny <id>` | Reject a pending action |
| `/confirm` | List all pending approvals with their IDs |

### Info

| Command | Description |
|---------|-------------|
| `/status` | Gateway state, uptime, idle time, enabled tools, hardware info |
| `/audit [n]` | Last N audit log events (default 10) |
| `/skills` | Prompt skills status and active count |
| `/help` | All commands inline in Telegram |

---

## Security Model

### Core guarantees

| Guarantee | How |
|-----------|-----|
| **Sleep-by-default** | Gateway starts dormant, ignores all messages except `/wake` from owner |
| **Single owner** | Only your Telegram user ID is authorised. Everyone else gets zero response |
| **Tools off by default** | All tools — builtin and MCP — are disabled on every wake |
| **Confirm before dangerous action** | Write, delete, execute, send, and background-spawn operations require `/confirm` |
| **Auto-sleep** | Inactivity timeout (default 30 min) returns to dormant; kills background processes |
| **Full audit trail** | Every event logged to `~/.safeclaw/audit.jsonl` |
| **Separate identity** | The bot is its own Telegram account, never acts as you |
| **Workspace sandboxing** | Filesystem tool restricted to `WORKSPACE_DIR` — no `../` escape |
| **MCP isolation** | Each MCP server runs as a subprocess; crashes don't affect SafeClaw |

### SecretGuard — LLM cannot see your secrets

SafeClaw has a dedicated security layer (`src/security/secret-guard.ts`) that sits between the LLM agent and the filesystem/shell tools. The LLM **cannot** access:

- Any `.env` or `.env.*` file
- `~/.safeclaw/auth.json` and `~/.safeclaw/*.json` (API keys and config)
- Any file whose name contains: `secret`, `password`, `credential`, `token` (case-insensitive)

If the LLM calls `read_file` on a protected path, it receives:
```
Access denied: this path is protected by SafeClaw security policy.
```

Shell output is additionally scrubbed: lines matching `KEY=...`, `TOKEN=...`, `SECRET=...`, `PASSWORD=...` have their values replaced with `[REDACTED]`. Shell commands that attempt to `cat` a protected file (e.g. `cat .env`, `cat ~/.safeclaw/auth.json`) are blocked before execution.

### Skill review

Dynamically proposed skills go through a two-stage process:
1. A dedicated **SkillCreator** sub-agent writes the code (not the main conversation LLM)
2. A **security Reviewer** agent checks the code for credential exposure, arbitrary execution, network exfiltration, and filesystem escape — up to 2 revision attempts
3. The final code is always shown in full before you `/confirm`

---

## Infrastructure Awareness

On every `/wake`, SafeClaw probes your system resources in the background:

```
/status
State: AWAKE
CPU: 8 cores
RAM: 6.2/15.8 GB free
GPU: NVIDIA GeForce RTX 3060 (8.5 GB VRAM free)
Ollama: llama3.2 (2.0GB), qwen2.5 (4.7GB)
```

This information is injected into the **manager agent's** system prompt so it knows how many parallel workers to spawn:

| Free RAM | Parallel workers |
|----------|-----------------|
| < 4 GB (no GPU) | 1 |
| 4–8 GB (no GPU) | 2 |
| > 8 GB or GPU present | 4 |

The probe also selects the largest Ollama model that fits in available VRAM/RAM as the `recommendedModel` for the orchestrator.

---

## Multi-Agent Orchestration

For complex multi-step tasks, SafeClaw routes to an adaptive multi-agent pipeline instead of a single LLM call.

### Routing heuristic

Free-text messages are classified as "complex" if they:
- Contain 3 or more sentences, **or**
- Contain keywords like `build`, `create`, `generate`, `analyse`, `debug and fix`, `implement`, `design`

Simple messages (single questions, short commands) go directly to the single-agent path.

### Pipeline

```
User message
     │
     ▼
 Complexity check
     │
     ├─ Simple ──────────────────────────► Single Agent (runAgent)
     │
     └─ Complex ─► Manager Agent (LLM)
                        │
                        ▼
                   TaskPlan
                   { strategy: "parallel" | "sequential" | "direct",
                     subtasks: [...],
                     needsReview: boolean }
                        │
                        ├─ direct ──────► Single Agent (runAgent)
                        │
                        ├─ parallel ────► Promise.all(workers) [capped by maxParallelWorkers]
                        │
                        └─ sequential ──► worker₁ → result₁ → worker₂(result₁) → ...
                                                │
                                                ▼
                                     Optional Reviewer Agent
                                     (validates output quality)
                                                │
                                                ▼
                                     Assembled response → user
```

### Agent roles

| Role | Description | Tool access |
|------|-------------|-------------|
| `manager` | Decomposes task into subtasks. Outputs JSON `TaskPlan`. Knows hardware limits. | None |
| `worker` | Executes one specific subtask. Runs safe actions immediately. | Full (read-only for dangerous ops) |
| `reviewer` | Validates worker output against original task. Outputs `{approved, feedback}`. | None |
| `skill_creator` | Writes skill code. Has access to filesystem read tools. | Read + filesystem write |

Workers execute **safe actions immediately** (read, list, browse) and report dangerous actions they would need as a list for the user to confirm. This keeps the approval model consistent even in multi-agent mode.

### Example

```
You:  build me a todo app with a REST API and tests

Bot:  📋 Task decomposed into 3 subtasks [sequential]:
        1. Design the data model and API endpoints
        2. Implement the Express.js server with all endpoints
        3. Write Jest tests for each endpoint

      [result from all workers assembled...]

      ⚠️ The following actions require /confirm before they can execute:
        • [Would execute] write_file: todo-app/server.js (842 chars)
        • [Would execute] write_file: todo-app/tests/api.test.js (512 chars)
```

---

## Background Process Execution

When the `shell` tool is enabled, the LLM can run commands in the background — useful for long-running tasks like builds, installs, or servers.

```
You:  run npm install in the background

Bot:  Action pending approval: exec_shell_bg: npm install
      /confirm a1b2c3d4

You:  /confirm a1b2c3d4
Bot:  Background process started.
      Session ID: f3a9b2c1

You:  check on the npm install
Bot:  [calls process_poll — returns accumulated output]
      added 842 packages in 23s
```

| Action | Safe? | Description |
|--------|-------|-------------|
| `exec_shell_bg` | Requires `/confirm` | Spawn a command, return session ID immediately |
| `process_poll` | Safe — no confirm | Read accumulated output from a session |
| `process_list` | Safe — no confirm | List all active/recent background sessions |
| `process_write` | Requires `/confirm` | Write to stdin of a running process |
| `process_kill` | Requires `/confirm` | Send SIGTERM to a running process |

Sessions are automatically cleaned up 30 minutes after the process exits. All running processes are terminated on `/sleep`, `/kill`, or auto-sleep.

---

## Self-Extending Skills

SafeClaw can detect when it lacks a capability and propose new skills at runtime — without a restart.

### How it works (new flow)

1. The main LLM hits a capability gap → calls `request_capability`
2. A dedicated **SkillCreator** sub-agent writes the complete skill code (not the main LLM)
3. A **security Reviewer** agent checks the code for vulnerabilities (up to 2 revision attempts)
4. The final code (with reviewer verdict) is sent to you as a proposal
5. `/confirm` installs it to `~/.safeclaw/skills/<name>.mjs` and activates it immediately

```
You:  create a PDF summary of my notes

Bot:  🔧 Skill Proposal: pdf_create
      ━━━━━━━━━━━━━━━━━━━━━━━━━━━
      Description: Create PDF documents from text content
      Needed for: Generating a PDF summary of workspace notes

      ⚠️  This skill performs potentially dangerous operations.
      ✅ Security reviewer approved this code.

      Generated code:
      ```
      export const skill = { ... };
      ```

      ⚠️  This code runs inside SafeClaw with full Node.js access.
      Review it carefully before approving.

      /confirm a1b2c3d4  →  install skill
      /deny a1b2c3d4     →  reject proposal
```

---

## MCP Tool Auto-Discovery

SafeClaw reads your Claude Code MCP settings and automatically discovers all tools on every `/wake`.

1. `/wake` is sent — bot replies immediately (MCP discovery is non-blocking)
2. Background: reads `~/.claude/settings.json` → `mcpServers`
3. For each `stdio` server: spawns process, calls `listTools()`, registers definitions
4. Tools appear in `/tools` grouped by server
5. Dangerous/safe classification by keyword heuristics (read/get/list/search → safe; write/delete/create/send → dangerous)

```
/enable mcp:github      → enable all tools for the "github" MCP server
/disable mcp:github     → disable them
/tools                  → see full list including MCP tools
```

Example `~/.claude/settings.json`:

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

> **Note:** Only `stdio` servers (with a `command` field) are supported. HTTP/SSE servers are skipped.

---

## Customisation

### Soul File — Custom Persona

Create `~/.safeclaw/soul.md` to override the default persona. Loaded on every `/wake` and appended to the system prompt (highest priority — overrides defaults).

```markdown
# My Assistant

You are an expert DevOps assistant. Keep responses extremely terse.
Always suggest the simplest possible solution.
Prefer shell one-liners over multi-step processes.
```

### Prompt Skills — Teach the LLM CLI Patterns

Drop `.md` files into `~/.safeclaw/prompt-skills/` to teach SafeClaw how to use specific CLI tools. SafeClaw checks whether required binaries are on your PATH and injects only active skills into the system prompt.

```markdown
---
title: GitHub CLI
bins: [gh]
---

## Using the GitHub CLI

Always prefer `gh` for GitHub operations:

- List open PRs: `gh pr list`
- View failed run logs: `gh run view --log-failed`
```

This skill activates only if `gh` is on PATH. Run `/skills` to see which are active.

**Frontmatter options:**

```yaml
---
title: My Tool         # shown in /skills — defaults to filename
bins: [git, curl]      # ALL must be on PATH for skill to activate
anyBins: [jq, python3] # AT LEAST ONE must be on PATH
---
```

### Persistent Memory

The `memory` tool lets the agent remember facts across sessions:

```
You:  remember that my main project is at ~/projects/myapp
Bot:  [calls memory_write: "main_project_path" = "~/projects/myapp"]
      Stored.
```

Memory is stored in `~/.safeclaw/memories/` and automatically injected into every system prompt.

---

## Context Management

### Context window guard
Tool results larger than 8 KB are truncated before being added to conversation history. This prevents a single large file read from consuming the entire context window.

### Auto-compaction
When conversation history exceeds ~60,000 tokens, SafeClaw calls the LLM to summarise the oldest 20 messages into a compact block. You'll see: `📦 Conversation compacted to fit context window.`

### Message debouncing
Multiple messages sent within 500 ms are merged into a single agent run. Prevents duplicate LLM calls from burst typing.

### URL auto-enrichment
When `browser` is enabled and your message contains a URL, SafeClaw fetches it silently and prepends the content to the message — the LLM sees the page without needing a tool call. Up to 3 URLs per message, capped at 6 KB each.

---

## Project Structure

```
safeclaw/
├── src/
│   ├── index.ts                  # Entry point and startup banner
│   ├── core/
│   │   ├── types.ts              # All TypeScript interfaces/enums incl. InfraContext
│   │   ├── gateway.ts            # State machine (dormant/awake/action_pending/shutdown)
│   │   │                         #   probes infra + connects MCP on wake
│   │   ├── auth.ts               # Single-owner Telegram ID check
│   │   └── config.ts             # .env loader and config validation
│   │
│   ├── channels/telegram/
│   │   ├── client.ts             # grammy bot setup
│   │   ├── handler.ts            # Inbound routing, auth check, 500ms debounce
│   │   ├── sender.ts             # Outbound with chunking for long replies
│   │   └── free-text.ts          # URL enrichment + routes to runAgent/runOrchestrated
│   │
│   ├── providers/
│   │   ├── types.ts              # LLMProvider interface, ProviderName, model defaults
│   │   ├── anthropic.ts          # Anthropic Claude client
│   │   ├── openai.ts             # OpenAI client
│   │   ├── gemini.ts             # Google Gemini client
│   │   ├── ollama.ts             # Ollama native /api/chat client + schema normaliser
│   │   ├── models.ts             # Live model listing from provider APIs
│   │   ├── store.ts              # Persists API keys to ~/.safeclaw/auth.json
│   │   ├── resolver.ts           # Picks the active provider + model
│   │   └── retry.ts              # Retry wrapper for transient API errors
│   │
│   ├── agent/
│   │   ├── session.ts            # Conversation history + orphan repair + token estimate
│   │   ├── tool-schemas.ts       # ToolDefinition → LLM tool_use schemas
│   │   └── runner.ts             # Main LLM loop: system prompt, safe execute,
│   │                             #   dangerous queue, context guard, auto-compaction,
│   │                             #   SkillCreator delegation on request_capability
│   │
│   ├── agents/                   # Multi-agent orchestration
│   │   ├── roles.ts              # Role system prompts (manager/worker/reviewer/skill_creator)
│   │   ├── sub-agent.ts          # Ephemeral SubAgent: runs tool loop, safe actions only
│   │   ├── orchestrator.ts       # runOrchestrated: manager→workers→reviewer pipeline
│   │   └── skill-creator.ts      # createSkillWithReview: SkillCreator + security Reviewer
│   │
│   ├── tools/
│   │   ├── registry.ts           # Tool map: enable/disable, MCP register/clear
│   │   ├── executor.ts           # Dispatches to real impl, MCP callTool, skill call
│   │   │                         #   SecretGuard checks before every filesystem op
│   │   ├── filesystem.ts         # Real fs: read, list, write, delete, move (sandboxed)
│   │   ├── browser.ts            # Real: fetch + Readability extraction
│   │   ├── shell.ts              # Real: child_process exec with 30s timeout
│   │   ├── patch.ts              # Real: apply Add/Update/Delete/Move patches
│   │   ├── memory.ts             # Persistent key-value memory store
│   │   └── process-registry.ts   # Background process sessions + TTL sweeper
│   │
│   ├── security/
│   │   └── secret-guard.ts       # SecretGuard: blocks protected paths, redacts env vars,
│   │                             #   checks shell commands for secret reads
│   │
│   ├── infra/
│   │   └── probe.ts              # probeInfra(): CPU/RAM/GPU/Ollama models
│   │                             #   getResourceLimits(): maxWorkers, recommendedModel
│   │
│   ├── skills/
│   │   ├── dynamic.ts            # DynamicSkill interface + .mjs file loader
│   │   ├── manager.ts            # SkillsManager: install, load, list, persist
│   │   └── prompt-skills.ts      # SKILL.md loader with bin-check + prompt injection
│   │
│   ├── mcp/
│   │   ├── config.ts             # Reads ~/.claude/settings.json mcpServers
│   │   ├── manager.ts            # Connect/discover/call/disconnect MCP servers
│   │   └── index.ts              # Barrel export
│   │
│   ├── permissions/
│   │   └── store.ts              # Pending approval store with 5-min expiry
│   ├── audit/
│   │   └── logger.ts             # Append-only JSONL event logger
│   ├── commands/
│   │   ├── parser.ts             # /command tokenizer
│   │   └── handlers.ts           # Handler for each command
│   └── storage/
│       └── persistence.ts        # JSON/JSONL read-write helpers
│
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
└── CLAUDE.md                     # Architecture and developer reference
```

### User data directories (`~/.safeclaw/`)

```
~/.safeclaw/
├── auth.json                     # Stored API keys (owner-only file permissions)
├── audit.jsonl                   # Append-only audit log
├── soul.md                       # Optional custom persona (injected on wake)
├── memories/                     # Persistent agent memory (key-value store)
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

| Feature | Status |
|---------|--------|
| Gateway state machine (dormant/awake/action_pending/shutdown) | ✅ |
| Single-owner auth with silent drop | ✅ |
| Runtime tool enable/disable | ✅ |
| `/confirm` dangerous action flow with 5-min expiry | ✅ |
| JSONL audit log | ✅ |
| Telegram bot (grammy) | ✅ |
| LLM agent — Anthropic, OpenAI, Gemini, Ollama | ✅ |
| Ollama native `/api/chat` with schema normalisation | ✅ |
| Live model listing from provider APIs | ✅ |
| Persistent API key storage | ✅ |
| Real filesystem tool (sandboxed to `WORKSPACE_DIR`) | ✅ |
| Real browser tool (fetch + Readability extraction) | ✅ |
| Real shell tool (`child_process`, 30s timeout) | ✅ |
| Apply-patch tool (Add/Update/Delete/Move) | ✅ |
| MCP auto-discovery from `~/.claude/settings.json` | ✅ |
| Self-extending dynamic skills (SkillCreator + security review) | ✅ |
| Soul file — custom persona | ✅ |
| Prompt skills — SKILL.md files injected into system prompt | ✅ |
| URL auto-enrichment — auto-fetch URLs in messages | ✅ |
| Message debouncing — merge burst messages | ✅ |
| Context window guard — truncate large tool results | ✅ |
| Auto-compaction — LLM summarises old history | ✅ |
| Background process execution — `exec_shell_bg` + poll/write/kill | ✅ |
| Persistent memory across sessions | ✅ |
| **SecretGuard — LLM blocked from reading secrets** | ✅ |
| **Infrastructure probe — CPU/RAM/GPU/Ollama on wake** | ✅ |
| **Multi-agent orchestration — manager/worker/reviewer pipeline** | ✅ |
| **SkillCreator agent — dedicated skill writing + security review** | ✅ |

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
| LLM: Ollama | Ollama native `/api/chat` (raw fetch, no wrapper library) |
| Browser | `@mozilla/readability` + `linkedom` |
| MCP | `@modelcontextprotocol/sdk` ^1.12.0 |
| Storage | File-based JSON + JSONL (no database) |
| Dev runner | `tsx` (TypeScript execute, no build step needed) |

---

## Roadmap

- [x] Gateway state machine, Telegram integration, commands, audit
- [x] Real filesystem tools with path sandboxing
- [x] LLM agent — Anthropic, OpenAI, Gemini, Ollama — with tool calling
- [x] Ollama native API + schema normalisation for small models
- [x] Live model listing from provider APIs
- [x] MCP tool auto-discovery from `~/.claude/settings.json`
- [x] Self-extending skills — SkillCreator agent + security Reviewer
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
- [x] Persistent memory across sessions
- [x] SecretGuard — LLM can never read API keys or `.env` files
- [x] Infrastructure probe — hardware-aware orchestration
- [x] Multi-agent orchestration — manager/worker/reviewer pipeline
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
