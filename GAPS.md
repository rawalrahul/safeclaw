# SafeClaw vs OpenClaw — Capability Gap Analysis
> Generated 2026-02-18. Reference only — no code changes made.

---

## What SafeClaw Has Today (Real, Working)

| Tool / Feature | Status |
|---|---|
| Telegram bot (grammy) | ✅ Real |
| Sleep-by-default gateway | ✅ Real |
| Single-owner auth + silent drop | ✅ Real |
| `/confirm` dangerous action flow | ✅ Real |
| Full audit log (JSONL) | ✅ Real |
| Filesystem tool (read/write/delete/list) | ✅ Real |
| Browser tool (fetch + Readability extraction) | ✅ Real |
| Shell tool (child_process, 30s timeout) | ✅ Real |
| Apply-patch tool (Add/Update/Delete/Move) | ✅ Real |
| MCP auto-discovery from ~/.claude/settings.json | ✅ Real |
| Multi-provider LLM (Anthropic, OpenAI, Gemini, Ollama) | ✅ Real |
| Skill forge (LLM proposes JS skills, user /confirms install) | ✅ Real |
| Audit events: tool_called + tool_result | ✅ Real |
| Proper system prompt (role: "system" for all providers) | ✅ Real (just fixed) |

---

## Gap 1 — Background Process Execution (HIGH VALUE)

**OpenClaw:** `exec` tool has a `yieldMs` parameter. If a command takes longer than `yieldMs`, it returns immediately with a session ID. The LLM then uses the `process` tool to poll, read logs, write to stdin, send keys (Ctrl-C, Enter), and kill the process.

**Why it matters:** Enables the LLM to spawn long-running tasks (builds, coding agents, servers, npm install) without blocking. The LLM can check back later. SafeClaw's shell tool blocks for up to 30s then cuts off — useless for anything slow.

**SafeClaw today:** Shell tool blocks synchronously. No session registry. No poll/write/kill. Output hard-capped at 30s / 10KB.

**What's needed:**
- A `ProcessRegistry` (in-memory map of sessionId → child process + output buffer)
- `exec_shell` upgraded: add `background: true` param, return session ID immediately
- New `process` tool: `poll`, `log`, `write`, `send_keys`, `kill` actions
- TTL sweeper to clean dead sessions after ~30 min

**Security risk:** Medium. All shell commands already require `/confirm`. Background just means the process runs after confirmation, same as today.

---

## Gap 2 — Skills System (HIGH VALUE, LOW RISK)

**OpenClaw:** `skills/` directory of SKILL.md files. Each file is a markdown prompt document injected into the LLM's system prompt at runtime. YAML frontmatter gates injection on whether required binaries (`bins`, `anyBins`) exist on PATH. No code runs — it's purely prompt injection that teaches the LLM to use existing CLI tools.

**Example skills from OpenClaw:**
- `weather` — teaches LLM to `curl wttr.in/London?format=3` (no API key)
- `github` — teaches LLM to use `gh pr checks`, `gh run view --log-failed`, `gh api --jq`
- `coding-agent` — teaches LLM to spawn Claude Code/Codex as PTY subprocess
- `tmux` — teaches LLM tmux session management with send-keys patterns
- `obsidian` — teaches LLM to use obsidian-cli for vault operations
- `session-logs` — teaches LLM to introspect its own conversation JSONL with `jq`/`rg`

**SafeClaw today:** Has a skill forge (LLM writes JS code → user approves → installs as ES module). Powerful but heavy — requires LLM to write correct code. No lightweight prompt-only skills.

**What's needed:**
- A `skills/` directory (markdown files with YAML frontmatter)
- Skill loader: on `/wake`, scan `skills/` for `.md` files, check `requires.bins` against PATH, inject passing skills into system prompt
- `/skills` command to list available/active skills
- User can drop a `my-skill.md` into the folder and it's live on next wake

**Security risk:** Near zero. Skills are just text injected into the system prompt. No code runs. The LLM still needs enabled tools + `/confirm` to act.

---

## Gap 3 — URL Auto-Enrichment in Messages (MEDIUM VALUE, ZERO RISK)

**OpenClaw:** When a message contains a URL, it's detected before the LLM sees it. The URL is fetched and extracted (via Readability or a CLI). The extracted content is appended to the message context before LLM inference. The LLM sees "here's your message + here's what that URL contains" without needing to call the browser tool explicitly.

**SafeClaw today:** If a user sends a URL in a message, the LLM has to call `browse_web` explicitly — and only if browser is enabled.

**What's needed:**
- Pre-processing step in `free-text.ts`: regex scan for `https?://` URLs in the message
- For each URL found: call `fetchUrl()` from existing `browser.ts`
- Append extracted content to the message before passing to LLM
- Gate on: browser tool must be enabled (reuse existing permission)

**Security risk:** Zero. Uses the same `fetchUrl()` already in the codebase. Only fires if browser tool is enabled.

---

## Gap 4 — Auto-Compaction of Conversation History (MEDIUM VALUE)

**OpenClaw:** When the conversation approaches the model's context limit, the history is split into chunks, each chunk is summarized by the LLM, the summaries are merged into one, and the history is reset with just the summary. Transparent to the user.

**SafeClaw today:** `trimHistory()` in `session.ts` exists but just slices the array (drops old messages). No summarization.

**What's needed:**
- Token counting (approximate: chars/4 or tiktoken)
- When history exceeds threshold (e.g., 80K tokens): call LLM to summarize oldest N messages
- Replace those messages with a single `system` summary message
- Notify user: "📦 Conversation compacted to fit context window"

**Security risk:** Zero. Pure internal state management.

---

## Gap 5 — Inbound Message Debouncing (LOW VALUE, ZERO RISK)

**OpenClaw:** If a user sends 3 messages in quick succession (e.g., typing in bursts), OpenClaw debounces them into a single agent run. Avoids spawning 3 parallel LLM calls.

**SafeClaw today:** Each message triggers an independent agent run. Could create race conditions in conversation history.

**What's needed:** Simple `setTimeout` debounce (e.g., 500ms) in the message handler before calling `runAgent`.

---

## Gap 6 — Bootstrap Hooks / Soul Files (LOW VALUE)

**OpenClaw:** User can place YAML "soul files" in a config directory that define the bot's persona. On-wake and on-sleep lifecycle hooks run user-defined shell scripts.

**SafeClaw today:** System prompt is hardcoded in `runner.ts`.

**What's needed:**
- Optional `~/.safeclaw/soul.md` file: if present, appended to system prompt on wake
- This alone covers 90% of the value — custom persona without code changes

**Security risk:** Low. File read only. Shell hooks would need `/confirm`.

---

## Gap 7 — Semantic Memory (LOW VALUE for now, COMPLEX)

**OpenClaw:** SQLite + sqlite-vec vector store + FTS5 BM25 hybrid search over memory markdown files and session transcripts. Gives the LLM persistent memory across sessions.

**SafeClaw today:** No memory. Each `/wake` starts fresh.

**What's needed:** `sqlite3` + `sqlite-vec` extension + embedding provider. Significant implementation effort.

**Security risk:** Low. Read-only from LLM perspective.

---

## Gap 8 — Context Window Guard (MEDIUM VALUE)

**OpenClaw:** Monitors token count mid-turn (during tool call loops). If the context grows unexpectedly large (e.g., a tool returns 50KB of output), it triggers compaction before the next LLM call.

**SafeClaw today:** No guard. A `browse_web` returning a large page could blow up the context silently.

**What's needed:** Token estimate check after each tool result. If `estimated_tokens > threshold`, truncate tool result or trigger compaction.

---

## Gap 9 — Multi-Provider Failover (LOW VALUE for personal use)

**OpenClaw:** If Anthropic returns 529 (overloaded), automatically retries with OpenAI. Supports multiple API key profiles with round-robin and cooldown.

**SafeClaw today:** Single active provider. Any API error is surfaced to user.

---

## Recommended Priority for SafeClaw

| Priority | Gap | Effort | Risk |
|---|---|---|---|
| 1 | Skills system (prompt-only SKILL.md files) | Low | Zero |
| 2 | URL auto-enrichment in messages | Very Low | Zero |
| 3 | Message debouncing | Very Low | Zero |
| 4 | Soul file (custom persona) | Very Low | Zero |
| 5 | Context window guard (truncate large tool results) | Low | Zero |
| 6 | Auto-compaction of conversation history | Medium | Zero |
| 7 | Background process execution + process tool | High | Medium |
| 8 | Semantic memory | Very High | Low |

---

## Why OpenClaw Feels "More Capable" — Root Causes

1. **Background execution** — The LLM can kick off a 5-minute build and do other things. SafeClaw blocks for 30s.
2. **Skills as prompt docs** — OpenClaw LLM knows how to use `gh`, `curl wttr.in`, `tmux`, etc. because it's taught explicitly. SafeClaw LLM has to figure it out from scratch each time.
3. **URL enrichment** — OpenClaw LLM sees link content automatically. SafeClaw LLM has to be asked to use the browser.
4. **PTY + send-keys** — OpenClaw can drive interactive CLI apps (vim, coding agents). SafeClaw shell only handles non-interactive commands.
5. **Auto-compaction** — OpenClaw conversations run indefinitely without hitting context limits. SafeClaw drops old messages silently.
6. **Media understanding** — OpenClaw can transcribe voice notes, read images, extract PDFs. SafeClaw has none of this.
