# SafeClaw — Developer Reference

## What This Is

SafeClaw is a **secure, privacy-first personal AI assistant** delivered as a Telegram bot. It is designed around a small set of hard security invariants (single owner, sleep-by-default, tools off by default, confirm-before-dangerous) and a layered architecture that adds features on top of those invariants without weakening them.

**Current state:** All four original phases + all gap fills + the upgrade plan are complete. `npm run typecheck` produces zero errors.

---

## Quick Dev Start

```bash
npm install
cp .env.example .env          # fill in TELEGRAM_BOT_TOKEN and OWNER_TELEGRAM_ID
npm run typecheck              # must be zero errors before any commit
npm run dev                    # tsx watch — auto-reloads on save
```

---

## Full Feature List

| Feature | File(s) |
|---------|---------|
| Gateway state machine (dormant/awake/action_pending/shutdown) | `src/core/gateway.ts` |
| Single-owner auth + silent drop | `src/core/auth.ts`, `src/channels/telegram/handler.ts` |
| Runtime tool enable/disable | `src/tools/registry.ts` |
| Dangerous action `/confirm` flow (5-min expiry) | `src/permissions/store.ts`, `src/agent/runner.ts` |
| JSONL audit log | `src/audit/logger.ts` |
| Telegram bot (grammy) | `src/channels/telegram/client.ts` |
| 500ms message debouncing | `src/channels/telegram/handler.ts` |
| URL auto-enrichment | `src/channels/telegram/free-text.ts` |
| LLM agent loop (tool calling, safe/dangerous routing) | `src/agent/runner.ts` |
| Conversation history + orphan repair + token estimate | `src/agent/session.ts` |
| Tool schema generation (builtin + MCP + dynamic) | `src/agent/tool-schemas.ts` |
| Context window guard (8 KB truncation) | `src/agent/runner.ts` → `guardToolResult()` |
| Auto-compaction (~60 K token threshold) | `src/agent/runner.ts` → `maybeCompact()` |
| LLM providers: Anthropic, OpenAI, Gemini | `src/providers/` |
| Ollama — native `/api/chat`, schema normalisation | `src/providers/ollama.ts` |
| Live model listing from provider APIs | `src/providers/models.ts` |
| Persistent API key storage | `src/providers/store.ts` |
| Real filesystem tool (sandboxed to WORKSPACE_DIR) | `src/tools/filesystem.ts` |
| Real browser tool (fetch + Readability) | `src/tools/browser.ts` |
| Real shell tool (child_process, 30s timeout) | `src/tools/shell.ts` |
| Apply-patch tool | `src/tools/patch.ts` |
| Persistent memory | `src/tools/memory.ts` |
| Background processes (exec_shell_bg, poll, write, kill) | `src/tools/process-registry.ts` |
| MCP auto-discovery from ~/.claude/settings.json | `src/mcp/` |
| Dynamic skills (SkillCreator + Reviewer + install) | `src/agents/skill-creator.ts`, `src/agent/runner.ts` |
| Soul file custom persona | `src/core/gateway.ts` → `loadPersonality()` |
| Prompt skills (SKILL.md injection) | `src/skills/prompt-skills.ts` |
| **SecretGuard** — blocks protected paths + redacts shell output | `src/security/secret-guard.ts` |
| **Infrastructure probe** — CPU/RAM/GPU/Ollama on wake | `src/infra/probe.ts` |
| **Multi-agent orchestration** — manager/workers/reviewer | `src/agents/orchestrator.ts` |
| **Adaptive routing** — simple → single agent, complex → orchestrated | `src/channels/telegram/free-text.ts` |

---

## Architecture Overview

```
Telegram message
       │
       ▼
  handler.ts          ← auth check (owner ID), debounce (500ms)
       │
       ├─ /command ──► handlers.ts
       │
       └─ free text ──► free-text.ts
                             │
                             ├─ URL enrichment (browser tool, up to 3 URLs)
                             │
                             ├─ isComplexTask() ──┐
                             │                    │ complex
                             │                    ▼
                             │            orchestrator.ts
                             │            ┌── manager LLM → TaskPlan
                             │            ├── workers (parallel | sequential)
                             │            └── reviewer (optional)
                             │
                             └─ simple / keyword fallback
                                         │
                                         ▼
                                   runner.ts (runAgent)
                                   ┌── system prompt (base + memories + skills + soul)
                                   ├── provider.chat(messages, toolSchemas)
                                   ├── safe tools → execute immediately
                                   ├── dangerous tools → create approval request
                                   ├── request_capability → SkillCreator agent
                                   ├── inline JSON tool call fallback
                                   └── auto-compaction if >60K tokens
```

---

## Core Security Invariants

These are enforced in code and must not be weakened:

1. **Single owner** — `src/core/auth.ts` compares `ctx.from.id` to `config.owner.telegramId`. Non-match → silent drop, no log visible to the sender.

2. **Sleep-by-default** — `Gateway.state` starts as `"dormant"`. All free-text is dropped unless `state === "awake" || state === "action_pending"`.

3. **Tools off by default** — `gateway.ts:wake()` calls `this.tools.disableAll()` before anything else.

4. **Confirm before dangerous** — `runner.ts:handleToolCalls()` checks `SAFE_ACTIONS` and routes everything else through `ApprovalStore.create()`. The LLM is never told to skip this — it cannot.

5. **SecretGuard** — `executor.ts` instantiates `SecretGuard` on every call and calls `guard.checkPath(absPath)` before any `read_file`, `write_file`, `delete_file`, or `move_file`. Shell commands are checked with `checkShellCommand(cmd)` and output is sanitised with `redactEnvVars(output)`.

---

## Key Type Decisions

```typescript
// ToolName is a plain string — accommodates dynamic MCP names like "mcp__github__search"
type ToolName = string;

// BUILTIN_TOOL_NAMES is a const tuple for narrowing where needed
const BUILTIN_TOOL_NAMES = ["browser", "filesystem", "shell", "patch", "memory"] as const;

// MCP registry key format: "mcp__<server>__<tool>"  (double underscore, LLM-safe)
// MCP enable/disable command format: "mcp:<server>"   (single colon, human-readable)

// ActionType is a union of all possible action strings used in executor dispatch
type ActionType = "read_file" | "write_file" | ... | "mcp_call" | "skill_call" | "skill_install";

// SAFE_ACTIONS: actions that execute immediately without /confirm
const SAFE_ACTIONS: ActionType[] = ["read_file", "list_dir", "browse_web", "process_poll", "process_list", "memory_read", "memory_write", "memory_list"];

// InfraContext: snapshot of system resources probed on wake
interface InfraContext { cpuCores, loadAvg, ramTotalGB, ramFreeGB, gpus[], ollamaModels[], probedAt }
```

---

## Gateway Lifecycle

```
dormant ──/wake──► awake ──inactivity──► dormant
                     │
                     └── dangerous action queued ──► action_pending
                                                          │
                                                          ├─ /confirm ──► back to awake
                                                          └─ /deny    ──► back to awake

awake/action_pending ──/sleep──► dormant
awake/action_pending ──/kill───► shutdown
```

**On wake:**
1. `state = "awake"`, `tools.disableAll()`, `tools.clearMcp()`, new `ConversationSession`
2. Background: `loadPersonality()` (soul.md + prompt skills)
3. Background: `probeSystemResources()` → fills `gw.infraContext`
4. Background: `connectMcpServers()` → discovers and registers MCP tools

**On sleep/kill/auto-sleep:**
- `tools.disableAll()`, `tools.clearMcp()`
- `processRegistry.dispose()` (kills background processes)
- `mcpManager.disconnectAll()`, `closeBrowser()`
- `infraContext = null`

---

## LLM Agent Loop (`src/agent/runner.ts`)

### `runAgent(gw, userText)`

1. Resolves provider + model from `ProviderStore`
2. Builds tool schemas: `[REQUEST_CAPABILITY_SCHEMA, ...buildToolSchemas(enabledTools)]`
3. Appends user message, calls `trimHistory()` (with orphan repair)
4. Builds system prompt: base + memories + active prompt skills + soul.md
5. Runs `maybeCompact()` if history > 60 K tokens
6. Calls `provider.chat(messages, toolSchemas, model)`
7. If no tool calls: falls back to `tryParseInlineToolCall()` (handles JSON blobs + `<tool_call>` XML)
8. If tool calls: `handleToolCalls()`

### `handleToolCalls()`

Key fix: collects **all** safe tool results in a single loop pass, then does **one** LLM follow-up after the loop. Previously it called the LLM inside the loop and returned after the first safe tool — this meant multiple tool calls in a single response were only partially processed.

```
for each toolCall:
  if request_capability → handleCapabilityRequest (spawn SkillCreator)
  if unknown mapping   → addToolResult(error)
  if tool disabled     → addToolResult(error)
  if safe action       → executeToolAction, addToolResult, set executedSafeTools = true
  if dangerous action  → create ApprovalRequest, set state = action_pending

if executedSafeTools:
  one LLM follow-up call
  if follow-up has more tool calls → recurse handleToolCalls
```

---

## Ollama Provider (`src/providers/ollama.ts`)

Uses the **native `/api/chat`** endpoint (not `/v1/chat/completions`). Key differences from the OpenAI-compat layer:

| Aspect | OpenAI-compat `/v1/chat/completions` | Native `/api/chat` |
|--------|--------------------------------------|---------------------|
| Response field | `choices[0].message` | `message` |
| `arguments` type | JSON string | JS object |
| Tool call `id` | present | absent → generate with `randomUUID()` |
| Tool result role | `tool` with `tool_call_id` | `tool` (no ID needed) |

**`normalizeSchemaForOllama(schema)`** strips: `additionalProperties`, `$ref`, `format`, `$schema`. Small models (qwen2.5-coder, llama3.2) reject or malfunction with these fields. The normaliser recurses into nested objects and arrays.

**`tryParseInlineToolCall()`** handles three fallback cases:
1. Model wraps in `<tool_call>...</tool_call>` XML tags (qwen2.5-coder)
2. Model wraps in triple-backtick code fence
3. JSON block appears with text before/after it

---

## SecretGuard (`src/security/secret-guard.ts`)

### Protected paths (checked in `executor.ts` before every filesystem op)

- Any `.env` or `.env.*` file
- `~/.safeclaw/auth.json` and any `~/.safeclaw/*.json`
- Storage dir (configurable) `*.json` files
- Any filename containing: `secret`, `password`, `credential`, `token` (case-insensitive)

```typescript
// In executor.ts, before every read/write/delete/move:
const guard = new SecretGuard(gw.config.storageDir);
const denied = guard.checkPath(absPath);
if (denied) return denied;  // returns "Access denied: ..." string, never throws
```

### Shell protection

- `checkShellCommand(cmd)`: blocks commands matching patterns like `cat .env`, `cat ~/.safeclaw/auth.json`
- `redactEnvVars(output)`: scans output lines, replaces values on lines matching `KEY=...` / `TOKEN=...` / `SECRET=...` / `PASSWORD=...`

---

## Infrastructure Probe (`src/infra/probe.ts`)

Called as `void this.probeSystemResources()` on wake (fire-and-forget). Fills `gw.infraContext`.

### What's probed

| Resource | How |
|----------|-----|
| CPU cores | `os.cpus().length` |
| RAM total/free | `os.totalmem()`, `os.freemem()` |
| Load average | `os.loadavg()[0]` (1-min; 0 on Windows) |
| GPU(s) | `nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits` — skipped if not found |
| Ollama models | `GET ${OLLAMA_URL}/api/tags` — skipped if Ollama is not running |

### `getResourceLimits(infra)`

Computes:
- `maxParallelWorkers`: 1 if <4GB free RAM (no GPU), 2 if 4–8GB, 4 if >8GB or GPU present
- `recommendedModel`: largest Ollama model that fits in free VRAM/RAM (80% of free RAM budget)
- `canParallelize`: `maxParallelWorkers > 1`

Injected into the manager agent system prompt so it knows how many workers to spawn.

---

## Multi-Agent Orchestration (`src/agents/`)

### Routing decision (`free-text.ts`)

```typescript
const useOrchestrated = isComplexTask(text) && !looksLikeKeywordCommand(text);
```

`isComplexTask()` returns true if:
- 3+ sentences (`.?!` count), **or**
- Contains keywords: `build`, `create`, `generate`, `make`, `develop`, `implement`, `analyse`, `analyze`, `debug and fix`, `refactor`, `redesign`, `plan`, `design`, `architect`

### Manager → TaskPlan

Manager receives the task + infra limits, outputs JSON:

```json
{
  "strategy": "parallel" | "sequential" | "direct",
  "subtasks": [
    { "id": "1", "description": "...", "role": "worker", "dependsOn": [] },
    { "id": "2", "description": "...", "role": "worker", "dependsOn": ["1"] }
  ],
  "needsReview": true
}
```

- `direct` → falls through to `runAgent()` (single-agent)
- `parallel` → `Promise.allSettled(workers)` in chunks of `maxParallelWorkers`
- `sequential` → loop, each task gets prior results injected as context

### Sub-agent contract (`sub-agent.ts`)

- Own ephemeral `ConversationSession` — never touches `gw.conversation`
- Runs up to `MAX_SUB_AGENT_TURNS = 8` turns before force-stopping
- **Safe actions**: executed immediately via `executeToolAction`
- **Dangerous actions**: skipped — description added to `result.pendingActions`
- Returned to orchestrator which shows pending actions to the user

### Roles and prompts (`roles.ts`)

| Role | Tool access | Prompt purpose |
|------|-------------|---------------|
| `manager` | None | Decompose task into subtasks, know hardware limits |
| `worker` | Full (safe only in sub-agent) | Execute one specific subtask |
| `reviewer` | None | Validate output, output `{approved, feedback}` JSON |
| `skill_creator` | Read + fs write | Write complete skill code |

---

## SkillCreator Flow (`src/agents/skill-creator.ts`)

Triggered when the main LLM calls `request_capability` during a conversation.

**Old flow:** Main LLM writes skill code inline → shown to user → `/confirm`

**New flow:**
1. Main LLM calls `request_capability` with `skill_name`, `skill_description`, `reason`, `dangerous`
2. `handleCapabilityRequest()` spawns `createSkillWithReview(gw, proposal)`
3. **SkillCreator agent** writes complete skill code (up to `MAX_REVISIONS + 1 = 3` attempts)
4. **Security Reviewer** checks each attempt for:
   - Credential exposure (reads `.env`, `auth.json`, secrets)
   - Arbitrary code execution (`eval()`, `new Function()`, `child_process` with user input)
   - Network exfiltration (unexpected POST to external servers)
   - Filesystem escape (writes outside allowed paths)
   - Infinite loops / resource exhaustion
5. If reviewer approves → present code to owner with `✅ Security reviewer approved`
6. If reviewer keeps rejecting → present last draft with `⚠️ Security reviewer had concerns: ...`
7. Owner `/confirm` → skill installed to `~/.safeclaw/skills/<name>.mjs` and auto-enabled

---

## MCP Discovery Flow

1. Owner sends `/wake`
2. Bot replies immediately (non-blocking)
3. `connectMcpServers()` fires as background Promise
4. `readMcpServersConfig()` reads `~/.claude/settings.json` → `mcpServers` (falls back to Claude Desktop path)
5. For each `stdio` server: `mcpManager.connectServer(name, config)` → spawns subprocess → `listTools()` → `tools.registerMcp(def)` for each
6. HTTP/SSE servers are skipped with a `console.warn`
7. `inferDangerous(toolName, description)` in `manager.ts` classifies each tool:
   - Contains read/get/list/search/fetch → safe
   - Contains create/write/delete/send/update/modify/remove/post → dangerous
   - Default → dangerous
8. `/tools` shows fresh data once discovery completes; tools are disabled by default

---

## Tool Registry and Executor

### Registry (`src/tools/registry.ts`)

- `registry.get(name)` → `ToolDefinition | undefined`
- `registry.getEnabled()` → `ToolDefinition[]` — only enabled tools are shown to the LLM
- `registry.registerMcp(def)` — registers an MCP tool (disabled by default)
- `registry.registerDynamic(skill, enabled?)` — registers a dynamic skill
- `registry.clearMcp()` — called on sleep to drop stale MCP registrations

### Executor (`src/tools/executor.ts`)

Dispatch logic:
```
toolName === "filesystem"   → resolveSafePath + SecretGuard + fsXxx()
toolName === "browser"      → fetchUrl()
toolName === "shell"        → checkShellCommand() + execShell() + redactEnvVars()
                              or processRegistry.spawn/poll/write/kill/list()
toolName === "memory"       → memoryRead/Write/List/Delete()
toolName === "patch"        → applyPatch()
action   === "mcp_call"     → mcpManager.callTool()
action   === "skill_call"   → skillsManager.get(name).execute(params)
action   === "skill_install"→ skillsManager.install() + tools.registerDynamic()
```

---

## Session History (`src/agent/session.ts`)

### `trimHistory(session)`

1. Slices to last `MAX_HISTORY = 50` messages
2. Repairs orphaned `tool_result` messages at the head: if the first message is `role: "tool_result"` with no preceding assistant turn that has `toolCalls`, it is removed. Repeats until no orphan. This prevents API errors on all providers (Anthropic, OpenAI, Ollama, Gemini all require a tool_use/tool_calls block before any tool_result).

### Token estimation

`estimateTokens(messages)` uses the 4 chars/token heuristic. Not precise, used only for the compaction threshold check.

---

## Command Reference (for handlers.ts)

| Command | Handler notes |
|---------|--------------|
| `/wake` | `gateway.wake()` → `sendMessage(wakeMsg)`. Also triggers background personality + infra probe + MCP discovery. |
| `/sleep` | `gateway.sleep()` — clears MCP tools, kills background processes, closes browser |
| `/kill` | `gateway.kill()` — same as sleep but sets state to `"shutdown"` |
| `/tools` | `registry.formatStatus()` — shows enabled/disabled for all tools |
| `/enable <tool>` | `registry.enable(name)` — accepts builtin names or `mcp:<server>` or `skill__<name>` |
| `/disable <tool>` | `registry.disable(name)` |
| `/confirm <id>` | `approvals.approve(id)` → `executeToolAction` → `continueAfterToolResult()` → LLM follow-up |
| `/deny <id>` | `approvals.deny(id)` → removes from `pendingToolCalls` |
| `/status` | `gateway.formatStatus()` — includes infra info if `gw.infraContext` is populated |
| `/audit [n]` | Reads last N lines of `audit.jsonl` |
| `/auth <provider> <key>` | `providerStore.set(provider, {type:"api_key", key})` |
| `/model <p/m>` | `providerStore.setModel(provider, model)` — validates provider exists |
| `/skills` | Lists prompt skills from `gw.promptSkills` with active/inactive status |

---

## File I/O Conventions

- `~/.safeclaw/` is the storage dir (configurable via `STORAGE_DIR` env, defaults to `~/.safeclaw`)
- `WORKSPACE_DIR` is the sandbox for all filesystem tool operations (configurable, defaults to `~/safeclaw-workspace`)
- All async file ops use `node:fs/promises`
- `persistence.ts` provides `readJson`, `writeJson`, `appendJsonl`, `readLastNLines`
- Audit log is append-only JSONL — never read at runtime except for `/audit` command

---

## Adding a New Builtin Tool

1. Add the tool name to `BUILTIN_TOOL_NAMES` in `src/core/types.ts`
2. Add action types to `ActionType` union and `SAFE_ACTIONS` array as appropriate
3. Add schema(s) to `buildToolSchemas()` in `src/agent/tool-schemas.ts`
4. Add action name mapping to `resolveToolCall()` in `src/agent/tool-schemas.ts`
5. Add input extraction to `extractToolDetails()` in `src/agent/tool-schemas.ts`
6. Add dispatch case to `executeToolAction()` in `src/tools/executor.ts`
7. Implement the tool in `src/tools/<name>.ts`

---

## Adding a New LLM Provider

1. Add provider name to `ProviderName` union in `src/providers/types.ts`
2. Add default model to `DEFAULT_MODELS`
3. Implement `class XxxProvider implements LLMProvider` in `src/providers/xxx.ts`
4. Export from `src/providers/resolver.ts` — add to `buildProvider()` switch
5. Add model listing to `src/providers/models.ts` if the provider has a model listing API

---

## Security Comparison with OpenClaw

| Aspect | OpenClaw | SafeClaw |
|--------|----------|----------|
| Identity | Hijacks user's WhatsApp | Own Telegram bot |
| Default state | Always-on daemon | Dormant until `/wake` |
| Tool access | Static config profiles | Runtime enable/disable |
| Dangerous actions | Executes immediately | Requires `/confirm` |
| Auth model | DM pairing (reactive) | Single owner by Telegram ID |
| Audit | Security audit command | Continuous JSONL audit log |
| Inbound from strangers | Pairing code response | Silent drop (zero info leak) |
| LLM | Hard-coded | Pluggable (Anthropic/OpenAI/Gemini/Ollama) |
| Tool extensibility | Fixed set | MCP auto-discovery |
| Secret protection | None | SecretGuard blocks LLM access to keys/env |
| Multi-step tasks | Single LLM | Manager/worker/reviewer agent pipeline |
| Hardware awareness | None | Probes CPU/RAM/GPU; calibrates parallelism |
| Skill writing | Main LLM inline | Dedicated SkillCreator + security Reviewer |
