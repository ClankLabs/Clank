# Changelog

All notable changes to Clank will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

---

## [1.12.1] — 2026-04-04

### Fixed
- **`/models` responsiveness** — local server detection now runs all probes in parallel (~3s instead of ~15s sequential). Command has a 5s race timeout so it never freezes the bot.
- **Telegram `/models` menu** — added to bot command menu so it appears in the `/` picker.
- **CLI `/models` help** — added to chat mode help text.

---

## [1.12.0] — 2026-04-04

### Added
- **Hot-swappable models** — switching the default model now takes effect on the next message without restarting the harness. The engine detects model config changes and automatically rebuilds with the new provider and system prompt.
- **`/models` command** — new slash command available on every interface (CLI, Telegram, Discord, Signal, Web). Lists all available models from configured providers and local servers (Ollama, LM Studio, llama.cpp, vLLM). Switch models inline with `/models set <provider/model>`.

### Fixed
- **Stale model identity** — after switching models, the agent's system prompt and `/status` now correctly report the active model instead of the one from session start.

---

## [1.11.3] — 2026-04-04

### Improved
- **Bash blocklist hardened** — expanded from 27 to 32 patterns. New coverage:
  - **Nested shell payloads** — `bash -c` / `sh -c` wrapping destructive commands (rm, mkfs, dd, chmod 777)
  - **Fork bomb** — `:(){:|:&};:` pattern (was documented in threat model but missing from code)
  - **Interpreter escapes** — `python -c`, `perl -e`, `ruby -e`, `node -e` calling `system()`, `exec()`, `os.system()`, or `child_process`
- **Threat model updated** — bypass section now reflects closed vectors and documents remaining gaps (variable expansion).

### Changed
- **Branding** — "gateway" terminology replaced with "harness" across all documentation, website, and marketing copy. CLI commands (`clank gateway start/stop/restart`) unchanged. Internal code unchanged.

---

## [1.11.2] — 2026-04-01

### Improved
- **Config parse errors** — malformed `config.json5` now shows the actual parse error and file path instead of silently falling back to defaults.
- **Setup validation** — empty Telegram/Discord bot tokens are caught during setup instead of saving `enabled: true` with no token. Port input validates range (1–65535) and checks if the port is already in use. Conflicting `--quick` and `--advanced` flags now warn.
- **Post-setup health check** — setup now tests model connectivity after saving config and suggests `clank models test` if unreachable.
- **Adapter startup summary** — harness prints a clear summary of which channel adapters started and which failed (with reason).
- **Actionable error messages** — provider "API key required" errors now include the command to fix them (`clank models add` or `clank setup`). The final fallback error gives diagnostic bullet points.
- **Session corruption warnings** — corrupt session index or message files log a warning instead of silently resetting.
- **TUI WebSocket safety** — malformed WebSocket frames no longer crash the TUI.
- **Model config guard** — missing `model.primary` in config gives a clear error instead of "Unknown provider: undefined".
- **CLI unknown commands** — unknown subcommands now show suggestions and a help hint instead of raw Commander output.

---

## [1.11.1] — 2026-03-31

### Changed
- **Local model context efficiency** — added context conservation hints to the local model system prompt. Instructs local models (9B, etc.) to use read_file with offset/limit, prefer bash for quick checks, save recurring facts to memory, reference earlier tool results, and spawn sub-agents for multi-step work. Reduces context blowup on constrained models without affecting cloud or 35B behavior.

---

## [1.11.0] — 2026-03-30

### Added
- **Self-verification loop** — optional post-completion pass where the agent reviews its own output against the original request. When gaps are found, the agent automatically revises. Enable with `behavior.selfVerify: true` in config. Only runs on main agents (not sub-agents) to avoid recursive verification.
- **`search_docs` tool** — RAG-style documentation search. Scans workspace markdown, code, and config files using TF-IDF ranking to find relevant context. Supports `scope` parameter: `"project"` (full workspace), `"docs"` (README/docs/ only), or `"all"` (default). Added to core tier and auto-tier triggers.
- **25 tools total** — `search_docs` brings the tool count from 24 to 25.

### Changed
- **System prompt** — updated to mention `search_docs` tool with usage guidance (rule 7). Rules renumbered.
- **Config schema** — new `behavior` section with `selfVerify` boolean (default: `false`).

---

## [1.10.0] — 2026-03-28

### Added
- **Sub-agents as core tool** — `spawn_task` is now a core tool available at all tiers. System prompt explicitly instructs agents on when and how to delegate to sub-agents.
- **Role-aware sub-agents** — new `role` parameter on `spawn_task`: `architect` (plan/design), `executor` (code/test/deploy), `auditor` (review/verify). Role context is injected into the sub-agent's prompt and RUNNER.md playbook.
- **Project context tool** — new `project_context` tool with `scan` (detect tech stack + directory tree from 30+ manifest files), `important_files` (git-active files + entry points), and `summarize` (auto-generate `.clank.md`). Available at all tiers.
- **Metrics collector** — in-memory tracking of request counts, latency (p50/p95/avg), token usage, task lifecycle, and errors. Exposed via `GET /metrics` HTTP endpoint and `metrics.get` RPC method.
- **Health dashboard panel** — new 9th panel in the web dashboard showing live metrics cards, active alerts, and per-agent request breakdown. Auto-refreshes every 10 seconds.
- **Alerts system** — `metrics.alerts` RPC method and `health` tool `alerts` action detect high latency, task failure rates, memory pressure, and error spikes.
- **Auto-tier triggers** — `spawn_task` and `project_context` are dynamically injected in "auto" tier when relevant keywords are detected in user messages.

### Changed
- **TOOLS.md** — added Sub-Agent Tools section with role descriptions, workflow patterns, and usage examples.
- **RUNNER.md** — added Roles section (Architect, Executor, Auditor, Custom) with per-role tool preferences and output expectations.

---

## [1.9.1] — 2026-03-27

### Fixed
- **Signal is Linux-only** — setup wizard and main setup now detect non-Linux and skip Signal with explanation. Windows/macOS install guides no longer mention Signal.

### Changed
- **Cross-platform install script** — `install.sh` now works on both macOS and Linux (detects platform, checks Node.js 20+, installs via npm). On Linux, mentions Signal setup.
- **Linux install guide** — added one-liner install option

---

## [1.9.0] — 2026-03-27

### Added
- **Signal setup wizard** — `clank setup --signal` guides through installing signal-cli, phone registration, SMS/voice verification, and config. Clank now manages the signal-cli daemon automatically.
- **Signal daemon lifecycle** — harness auto-starts the signal-cli daemon when Signal is enabled and stops it on shutdown. No manual daemon management needed.
- **Update check on harness launch** — checks npm for newer versions on startup. Prompts Y/N if an update is available. Never auto-updates.
- **Health check tool** — `health_check` tool lets the agent diagnose system health (providers, adapters, memory, disk) and restart failed adapters. 24 tools total.

---

## [1.8.2] — 2026-03-27

### Fixed
- **Web dashboard 404** — `clank dashboard` returned "Not found" because the Web UI path resolved one directory too high. The HTML file is inside `dist/web/` but the server was looking at `../web/` relative to `dist/`.

### Changed
- **Documentation rewrite** — all external docs rewritten for v1.8.x state. Per-OS install guides (Windows, macOS, Linux). Updated security, privacy, architecture, user guide, contributing, alignment, and threat model docs.

---

## [1.8.1] — 2026-03-27

### Fixed
- **Inline tool approvals** — Telegram and Discord now show the actual tool name and description instead of "unknown tool" (property name mismatch: `name` → `toolName`)

### Changed
- **Web tools promoted to core tier** — `web_search` and `web_fetch` are now available at all tool tiers (core, auto, full). Previously only available in "full" or via keyword triggers in "auto", which meant local models couldn't use them even with an API key configured.
- **System prompt** — added explicit web search guidance telling models to use `web_search` for current events, docs, APIs, and uncertain answers instead of guessing

---

## [1.8.0] — 2026-03-27

### Added
- **Signal adapter** — full Signal messenger integration via signal-cli JSON-RPC daemon. DM and group support, phone number allowlist, per-chat message queue, slash commands, tool indicators. Zero new npm dependencies.
- **Shared command handler** — all adapters (Telegram, Discord, Signal) now share a unified `/command` handler. No more duplicated command logic.
- **Inline tool approvals (Telegram)** — when a tool needs confirmation, Telegram sends an inline keyboard with Approve / Always / Deny buttons. Auto-approves after 30s timeout.
- **Inline tool approvals (Discord)** — same approval flow using Discord button components. Slash commands now supported in Discord.

### Changed
- **Discord adapter** — upgraded from non-streaming to streaming harness calls, added slash command routing
- **Adapter architecture** — `toolEmoji()`, `splitMessage()`, and all shared command logic extracted to `src/adapters/commands.ts`
- **Harness streaming API** — added `onConfirm` callback to `handleInboundMessageStreaming()` for interactive tool approval. Adapters without confirmation UI (Signal, Web) auto-approve as before.

---

## [1.7.6] — 2026-03-27

### Improved
- **Web fetch returns readable text** — `web_fetch` now strips HTML tags, scripts, styles, and navigation from web pages, returning clean plain text. Local models no longer choke on raw HTML soup when fetching URLs. JSON responses are still returned as-is.

### Fixed
- **Wrench 9B naming** — README now correctly refers to Wrench 9B (was "8B"), with HuggingFace download link added

---

## [1.7.5] — 2026-03-27

### Changed
- **Organization migration** — package moved from `@tractorscorch/clank` to `@clanklabs/clank`. All GitHub repos now live under the [ClankLabs](https://github.com/ClankLabs) organization. No functional changes.

---

## [1.7.4] — 2026-03-26

### Fixed
- **Telegram/Discord typing indicator crash** — `sendChatAction` and `sendTyping` calls now fail silently instead of aborting message processing. Telegram rate-limits typing indicators (429 Too Many Requests), which would kill the entire message handler after sustained conversations. Discord's `sendTyping` gets the same treatment for consistency

---

## [1.7.3] — 2026-03-25

### Added
- **Smart memory for local models** — local models no longer load the full MEMORY.md into the system prompt (wastes context tokens). Instead, memories are injected via TF-IDF relevance matching with a tighter 800-char budget, keeping only what's relevant to the current conversation
- **System file protection rule** — agents are now instructed not to modify, delete, or overwrite files outside the workspace or current working directory unless the user explicitly names the file. Prevents local models from touching system files, OS directories, or config dotfiles unprompted
- **Proactive auto-compaction** — context is now checked after every tool result (not just at the start of each loop iteration). If a large tool result pushes context past the threshold, tier-1 compaction fires immediately with zero latency. A pre-send safety check at 90% utilization catches anything that slips through
- **Context overflow recovery** — if a provider returns a context-length error, the engine now auto-compacts aggressively and retries once instead of crashing. If context is still critically full (>95%), warns the user to use `/compact` or `/new`

### Fixed
- **TF-IDF memory relevance** — `buildMemoryBlock()` was called with an empty query string, making relevance scoring useless. Now passes session context for proper matching

---

## [1.7.2] — 2026-03-24

### Added
- **Agent runner template (RUNNER.md)** — structured playbook for sub-agents with task decomposition, tool patterns, and report format. Automatically injected into system prompt for spawned tasks so the model doesn't have to figure out the approach from scratch
- **`/compact` command** — save model state, clear context, continue where you left off. Available in TUI and Telegram. Uses the LLM to summarize current task state, then clears the conversation and injects the summary as the starting point
- **CLI/TUI ASCII banner** — Clank logo displayed on startup in both direct chat and TUI mode

### Fixed
- **Telegram typing indicator leak** — typing indicator now cleared in `finally` block instead of `try` block, so it always stops even if an error occurs during streaming or message editing. Previously, errors would leave the chat permanently showing "typing..."
- **Install instructions** — split `npm install` and `clank setup` into separate code blocks in README so copying the block doesn't auto-run setup before install finishes
- **CLI chat version** — was hardcoded as `v0.1.0`, now shows correct version

---

## [1.7.1] — 2026-03-23

### Added
- **Telegram bot menu** — all commands registered with Telegram via `setMyCommands()`, appear when you type `/`
- **Tool indicators with emojis** — when the agent uses tools, Telegram shows emoji indicators above the response (📄 read\_file, 💻 bash, 🔍 search, 🌐 web, ✏️ edit, 🚀 spawn, etc.)
- **`/kill <id>` command** — kill a specific background task by short ID (first 8 chars), cascades to children
- **`/killall` command** — kill all running background tasks
- **`/version` command** — show Clank version
- **`/think` per-chat toggle** — actually toggles thinking display per Telegram chat (was a no-op before)

### Changed
- **`/tasks` shows short IDs** — each task now shows its 8-char ID for use with `/kill`
- **`/status` shows more info** — model, agents, running tasks, thinking state, uptime
- **`/agents` shows default agent** — includes the default agent and its model, not just custom agents
- **`/model` shows fallbacks** — displays the full fallback chain
- **`/agent <name>` works** — actually switches agent by resetting session (was a stub)
- **Comprehensive docs** — full rewrite of Install Guide and User Guide for v1.7.x features
- **Website docs page** — new /docs tab on clanksuite.dev with provider table, command reference, and quick start

---

## [1.7.0] — 2026-03-23

### Added
- **OpenAI Codex OAuth** — sign in with your ChatGPT Plus/Pro account to use Codex models without API costs. Full Authorization Code + PKCE flow with browser-based login, token refresh, and credential storage
- **`clank auth` commands** — `clank auth login` (OAuth flow), `clank auth status` (show credentials), `clank auth logout` (remove credentials)
- **OpenCode provider** — subscription-based API at `opencode.ai/zen` with many models
- **Sub-agent depth control** — configurable `maxSpawnDepth` (default 1) prevents infinite nesting. Depth 0 = main, depth 1+ = sub-agent. Leaf agents cannot spawn further
- **Sub-agent concurrent limits** — configurable `maxConcurrent` (default 8) prevents resource exhaustion
- **Task kill/steer/message** — parent agents can kill running tasks (with cascade), restart with new instructions (steer), or send messages to running children
- **Parent-child task tree** — tasks track their children and parent for full tree visibility
- **Sub-agent system prompt** — spawned agents are told who spawned them and whether they can spawn further
- **`task.kill` RPC** — kill tasks from Web UI and TUI

### Changed
- **Spawn system depth-aware** — any agent within the depth limit can spawn (not just the default agent), enabling orchestrator → worker patterns

---

## [1.6.0] — 2026-03-23

### Added
- **Multi-provider support** — configure multiple cloud providers (Anthropic, OpenAI, Google, OpenRouter) during setup. Each provider can be assigned to different agents for true multi-model workflows
- **OpenRouter provider** — access hundreds of models through one API key via OpenRouter's OpenAI-compatible API. Model format: `openrouter/model-name`
- **Background task system** — main agent can spawn tasks on sub-agents that run independently. `spawn_task` tool with spawn/status/list actions. Results auto-injected into main agent's context when tasks complete
- **Task registry** — in-memory registry tracks running/completed/failed/timed-out tasks with automatic cleanup
- **Telegram `/tasks` command** — view background task status from Telegram
- **`task.list` and `task.status` RPC methods** — task visibility from Web UI and TUI

### Changed
- **Setup wizard loads existing config** — re-running `clank setup` preserves your existing API keys and settings instead of starting from scratch. Each step shows pre-existing values and lets you keep them
- **Multi-provider onboarding loop** — setup now lets you add multiple cloud providers in a loop instead of just one

---

## [1.5.10] — 2026-03-23

### Fixed
- **Telegram/Discord hangs forever when agent uses tools** — medium/high safety tools (bash, write_file, edit_file) require user confirmation, but the adapter streaming path had no confirmation handler. The engine would emit `confirm-needed`, nobody would respond, and the agent hung indefinitely with Telegram stuck on "typing". Now auto-approves all tool confirmations for non-interactive channels

---

## [1.5.9] — 2026-03-23

### Changed
- **Workspace defaults to current directory** — the agent's workspace is now the directory you run `clank` from, not a hidden `%APPDATA%/Clank/workspace` folder. This means the agent works with your actual project files out of the box
- **Full file system access** — the path guard no longer blocks reads/writes outside the workspace. Clank is a dev tool and needs to access the full system. Added security notice to README recommending dedicated hardware

### Fixed
- **Telegram `/new` and `/reset` were no-ops** — these commands returned a "session started" message but never actually reset the session. The model kept its full conversation history. Now properly clears session store, context engine, and destroys the old engine instance
- **Security notice added to README** — recommends running Clank on dedicated hardware since it gives agents full system access

---

## [1.5.8] — 2026-03-23

### Added
- **Collapsible thinking blocks** — model thinking/reasoning is now displayed in a separate clickable block above the response instead of being streamed into the message text. Click the "Thought" toggle to expand/collapse. Shows "Thinking..." while streaming, "Thought" when complete

### Fixed
- **Thinking events were disconnected** — the full thinking pipeline (provider → agent → harness → frontend) was broken at 3 points: provider yielded thinking as text for local models, agent only emitted a one-shot start event without content, and harness didn't forward thinking events to clients. All 3 fixed
- **Empty responses from thinking-only models** — when a model puts all output in `reasoning_content` with empty `content` (Qwen3.5), the thinking text is now used as the response instead of showing a blank message

---

## [1.5.7] — 2026-03-23

### Fixed
- **Tools completely broken for llama.cpp / LM Studio / vLLM models** — the PromptFallbackProvider (which injects tools into the system prompt as text) was only applied to Ollama models. All other local providers (llama.cpp, LM Studio, vLLM) sent tools via the API's `tools` parameter, which most local models can't handle — so they just ignored tools entirely. Now ALL local models that aren't in the known tool-capable list automatically get prompt-based tool injection
- **Tool-capable model detection shared across providers** — moved the `TOOL_CAPABLE_PATTERNS` list from the Ollama provider to a shared `supportsNativeTools()` function in types.ts, used by the agent engine for any local provider

---

## [1.5.6] — 2026-03-23

### Fixed
- **Local models still refusing actions** — v1.5.5 prompt wasn't forceful enough. Rewrote system prompt as a dense, authoritative rules block with numbered rules and explicit list of available tools. Added negative examples ("NEVER say 'I cannot access files'") which are more effective at overriding local model training biases than positive instructions alone

---

## [1.5.5] — 2026-03-23

### Fixed
- **Local models refuse to use tools** — models claimed "I can't access your files" despite having `read_file`, `write_file`, etc. available. Strengthened the system prompt to explicitly tell the model it runs locally on the user's machine with direct file system access and must never refuse file operations

---

## [1.5.4] — 2026-03-23

### Fixed
- **Streaming dies mid-answer with local models** — added per-chunk idle timeout (60s) that detects when the model hangs between chunks (GPU OOM, Ollama crash). Previously the only timeout was the 5-minute overall timer, which couldn't detect mid-stream stalls
- **Incomplete responses treated as complete** — when a stream ends without the `[DONE]` marker (connection drop, model crash), the response is no longer silently accepted. The provider now throws an error so the agent retries instead of showing a half-finished answer
- **Agent retry on stream failure** — the retry loop now resets partial state on retry and recognizes stream drops/empty responses as retryable errors, automatically attempting once more before giving up
- **XSS in web dashboard** — 3 places where server data (`role`, `a.status`, `j.lastStatus`) was rendered as raw HTML without escaping (CodeQL CWE-79)
- **Incomplete glob sanitization in search-files** — `.replace("*", "")` only stripped the first `*`; changed to `.replaceAll()` (CodeQL CWE-116)

---

## [1.5.3] — 2026-03-23

### Fixed
- **Local thinking models return empty responses** — Qwen3.5 puts all output in `reasoning_content` with empty `content`, and `enable_thinking:false` doesn't work (chat template overrides it). Now treats `reasoning_content` as text for local models so the user actually sees a response

---

## [1.5.2] — 2026-03-23

### Fixed
- **Thinking models (Qwen3.5) exhaust tokens on reasoning** — the model generates `<think>` reasoning tokens that eat the entire context window, leaving nothing for actual content. Added default `max_tokens: 4096` for local models and `reasoning_effort: "low"` to reduce thinking overhead
- **Telegram shows nothing during model thinking** — added periodic "typing" indicator every 4 seconds so the bot doesn't appear dead while the model processes internally
- **Root cause found via direct API testing** — Qwen3.5-35B returns empty `content` with all output in `reasoning_content`; without a max_tokens cap, the model spends all its budget on thinking

---

## [1.5.1] — 2026-03-23

### Fixed
- **Local models timing out on tool calls** — removed per-chunk read timeout that was killing legitimate slow processing; a 35B quantized model can take minutes for prefill on large contexts, that's normal not a hang
- **Local model timeout increased to 5 minutes** — was 120s (too short for large quantized models doing prefill on big contexts with tool results)
- **Memory budget reduced for local models** — memory injection now uses 1.5K chars (was 4K) to avoid eating the limited context window of local models (8K-32K vs 128K+ for cloud)

---

## [1.5.0] — 2026-03-23

### Fixed
- **Model hangs forever on large prompts/tool calls** — the connection-level timeout (120s) only covers the initial HTTP request; once streaming starts, `reader.read()` waits indefinitely for the next chunk. Added per-chunk 60s timeout via `Promise.race` — if the model stops sending data mid-stream (OOM, stuck processing), Clank detects it and reports an error instead of hanging forever
- **Debug logging for Telegram** — added request/response lifecycle logging to diagnose message handling issues

---

## [1.4.9] — 2026-03-22

### Fixed
- **llama.cpp/local models crashing on tool calls** — OpenAI provider (used for llama.cpp, LM Studio, vLLM) was missing the orphaned tool result filter that Ollama had; orphaned tool results after compaction caused 400 API errors and permanent session corruption
- **Local model timeout too short** — OpenAI provider used 90s cloud timeout for local models; now uses 120s for local (matching Ollama) since large quantized models need time to process

---

## [1.4.8] — 2026-03-22

### Fixed
- **Model hangs permanently after tool calls** — provider timeout was bypassed when the engine passed its own AbortSignal (always); now uses `AbortSignal.any()` to combine the caller's signal with a hard 120s timeout so hung models are detected and reported instead of blocking forever
- **No retry on timeout** — engine no longer retries when a model times out (was doubling the wait to 240s with no chance of success); timeouts propagate immediately as errors

---

## [1.4.7] — 2026-03-22

### Fixed
- **Tool calling crashes harness** — context compaction could split tool call / tool result message pairs, sending orphaned messages to Ollama which returns 400 errors and corrupts the session permanently; compaction now drops complete pairs together
- **Orphaned tool result safety net** — Ollama provider now filters out orphaned tool results before sending to the API, preventing 400 errors even if compaction misses a pair

---

## [1.4.6] — 2026-03-22

### Fixed
- **Telegram stutter (for real)** — when the model responds fast, the initial `sendMessage` promise hasn't resolved by the time the full response is ready, causing a duplicate message via the fallback path; now waits for the in-flight message ID before falling back

---

## [1.4.5] — 2026-03-22

### Fixed
- **Harness unresponsive after messages** — WebSocket frame handler was not awaited, causing unhandled promise rejections that silently killed the harness process
- **Added `unhandledRejection` handler** — harness now logs rejected promises instead of dying silently
- **Provider timeout fallback** — all providers (Ollama, Anthropic, OpenAI, Google) now have a fallback timeout (120s local, 90s cloud) if no abort signal is provided, preventing indefinite hangs when a model is unresponsive

---

## [1.4.4] — 2026-03-22

### Fixed
- **Harness crash after 4-5 messages** — confirmation handler WebSocket listeners were never removed on timeout, accumulating orphaned handlers per message until the process crashed
- **Engine listener limit** — set `maxListeners` to 30 on AgentEngine (Node.js default of 10 was too low since each message cycle wires 10 event listeners)
- **Rate limiter memory leak** — stale session entries in the rate limiter Map were never purged; added periodic cleanup when map exceeds 100 entries

---

## [1.4.3] — 2026-03-22

### Fixed
- **Telegram streaming stutter** — fixed race condition where multiple partial messages were sent instead of editing a single message; added synchronous guard flag to prevent duplicate `sendMessage` calls while the initial message promise is in-flight
- **Harness killed by `clear` on Windows** — replaced `fork()` with `spawn()` + `windowsHide` for background harness process; `fork` kept an IPC channel tied to the parent console, so clearing PowerShell killed the harness
- **`clank update` fails on Windows** — added `--force` to the npm install command to overwrite locked shim files (`clank.ps1`, `clank.cmd`)

---

## [1.4.1] — 2026-03-23

### Security
- **Config get redaction** — `config get` action now redacts sensitive keys (apiKey, token, botToken) before returning to LLM context
- **Config set protection** — config tool now blocks prototype pollution (`__proto__`, `constructor`, `prototype`)
- **Rate limit streaming path** — `handleInboundMessageStreaming` now enforced (was bypassing rate limiter)
- **SSRF private IPs** — web_fetch now blocks RFC 1918 ranges (10.x, 192.168.x, 172.16-31.x) and IPv4-mapped IPv6
- **STT workspace containment** — speech_to_text tool now uses guardPath() to prevent reading files outside workspace

### Audit Result
- 0 dependency vulnerabilities
- 14 PASS, 1 WARN (bash blocklist is defense-in-depth), 0 FAIL
- Grade: A

---

## [1.4.0] — 2026-03-23

### Added
- **Telegram streaming** — responses edit in real-time as tokens arrive (800ms interval, respects rate limits)
- **Telegram image handling** — send photos to the bot, routed to agent with image URL
- **Telegram document handling** — send files to the bot, saved to temp with sanitized filenames, agent can read them
- **File share tool** — `share_file` lets the agent send workspace files through channels (workspace containment enforced)
- **Per-agent voice** — each agent can have its own ElevenLabs voice ID in config
- **Compact prompt mode** — `compactPrompt: true` strips workspace files for small model context optimization
- **Thinking control** — `thinking: "off"` suppresses extended reasoning for faster responses
- **Auto-memory persistence** — "remember X", preference statements, and corrections auto-saved to MEMORY.md
- **Web UI session history** — loads last 50 messages on connect and session switch
- **Rate limiting** — 20 messages per minute per session, prevents model flooding

### Improved
- **Model retry** — one retry with 2s backoff on transient connection failures
- **Session resume compaction** — auto-compacts on load if over context budget
- **Memory persistence instruction** — system prompt now encourages the agent to save learnings

### Security
- Telegram document uploads: filename sanitized (path traversal protection), 10MB size limit
- File share tool: workspace containment via guardPath
- Rate limiting prevents denial-of-service via message flooding
- Per-agent voice IDs read from config only (not from user input)

---

## [1.3.1] — 2026-03-23

### Fixed
- **STT not working** — local whisper.cpp was selected by default but not installed. Added Groq as the recommended free STT provider (whisper-large-v3-turbo).
- **STT provider priority:** Groq (free, fast) → OpenAI Whisper → local whisper.cpp
- **Setup wizard:** STT now offers Groq as option 1 (recommended), OpenAI as option 2, local as option 3

---

## [1.3.0] — 2026-03-23

### Added
- **ElevenLabs integration** — text-to-speech via ElevenLabs API, configurable during onboarding
- **Whisper integration** — speech-to-text via OpenAI Whisper API or local whisper.cpp
- **Voice tools (3):** `text_to_speech`, `speech_to_text`, `list_voices` — agent can generate and transcribe audio
- **Telegram voice messages** — send a voice message → auto-transcribed via Whisper → routed to agent → response as voice (ElevenLabs) or text
- **Integrations config section** — unified config for third-party API services (ElevenLabs, Whisper, image gen, extensible)
- **Setup wizard integrations step** — configure ElevenLabs, Whisper, and other API services during onboarding

### Changed
- Tool count: 21 total (10 core + 11 self-config/voice)
- Setup wizard now asks about integrations for all users (not just advanced mode)

---

## [1.2.1] — 2026-03-23

### Fixed
- **Harness crash on restart** — stale Telegram messages queued while offline no longer flood the model. Messages older than 30s before startup are dropped.
- **Parallel model overload** — Telegram messages from the same chat are now processed sequentially (per-chat queue) instead of all at once.

---

## [1.2.0] — 2026-03-22

### Added
- **Two-tier context compaction** — critical for local model performance:
  - Tier 1 (fast): system prompt budgeting, tool result dedup, message truncation, aggressive dropping
  - Tier 2 (LLM-summarized): model generates conversation recap replacing oldest messages. Preserves meaning over long sessions.
  - Token budgeting: reserves 25% for response, budgets system prompt separately from conversation
- **`clank update`** — update to latest npm version, preserves config/sessions/memory, restarts harness

---

## [1.1.0] — 2026-03-22

### Security Hardening
- **Bash tool:** expanded blocklist from 5 to 25 patterns — covers flag variations, shell-in-shell, encoded payloads, PowerShell, system damage commands
- **Path traversal:** all file tools (read, write, edit, list, search, glob) now enforce workspace containment via `guardPath()` — blocks absolute paths and `../` traversal outside workspace
- **Config redaction:** API keys, bot tokens, and auth tokens are stripped from config before exposing to LLM context or WebSocket clients
- **Prototype pollution:** config.set RPC blocks `__proto__`, `constructor`, `prototype` keys
- **SSRF protection:** web_fetch blocks localhost, cloud metadata endpoints (169.254.169.254), .internal/.local hostnames, file:// protocol
- **Harness auth:** auto-generates token on startup if mode is "token" but no token configured — prevents accidental open gateways
- **Status endpoint:** /status now requires Bearer token authentication
- **Tool confirmations:** harness respects autoApprove config instead of blindly approving — 30s timeout defaults to deny
- **.gitignore:** added config.json5, *.pem, *.key, credentials.json to prevent accidental secret commits

### Bug Fixes
- **Telegram bot not responding:** `bot.start()` was blocking (awaited) which prevented the harness from finishing startup. Now runs non-blocking with `onStart` callback.
- **Telegram allowFrom:** now matches both `@username` and numeric user IDs (was only matching numeric)
- **grammY missing:** added as real dependency (was dynamic import that failed silently)
- **Local server URL not saved:** setup wizard now saves detected server baseUrl for all local providers (was only saving Ollama)
- **Port conflict:** default port changed to 18790 (was 18789, conflicted with OpenClaw/Claude Code)
- **--web flag:** `clank chat --web` now auto-starts harness and opens browser
- **Harness text/message param:** accepts both `message` and `text` fields from clients

### Added
- **TUI:** rich terminal UI with streaming, tool cards, thinking blocks, agent/session/model pickers, slash commands, shell integration (`!command`)
- **Web Control UI:** 8-panel dashboard — Chat, Agents, Sessions, Config (JSON editor), Pipelines, Cron, Logs, Channels
- **Telegram slash commands:** /help, /status, /agents, /agent, /sessions, /new, /reset, /model, /think
- **CLI commands:** tui, dashboard, pipeline, cron, channels, uninstall
- **Background harness:** runs as detached process, Telegram/Discord stay alive while CLI/TUI/Web run on top
- **Harness singleton:** refuses to start if already running on the port
- **Self-config tools (8):** config, manage_channel, manage_agent, manage_model, manage_session, manage_cron, gateway_status, send_message
- **Google Gemini provider** with streaming and function calling
- **Memory system:** TF-IDF cosine similarity with decay scoring, categorized storage
- **Encryption:** AES-256-GCM for API keys, PIN hashing with timing-safe comparison
- **Web search:** Brave Search API integration
- **Config hot-reload:** watches config.json5 for changes
- **`clank uninstall`:** removes all data, daemon, and npm package

### Changed
- Default command (`clank` with no args) starts harness in background then launches TUI
- `clank gateway start` now runs in background by default (`--foreground` for blocking mode)
- `clank gateway restart` fully implemented (stop + start)
- Protocol updated to v1 spec with 17 RPC methods and 11 event types

---

## [1.0.0] — 2026-03-22

Initial release — Clank Gateway foundation.

### Architecture
- Single harness daemon (HTTP + WebSocket on port 18789)
- WebSocket JSON-RPC protocol v1 with 17 RPC methods and 11 event types
- All interfaces are equal — CLI, TUI, Web UI, Telegram, Discord

### Engine
- AgentEngine with ReAct loop (stream → tool calls → execute → loop, max 50 iterations)
- Pluggable ContextEngine with compaction optimized for local models (60% threshold vs 80% cloud)
- Tool tiering: full/core/auto — reduces tool count for smaller models
- PromptFallbackProvider for models without native function calling

### Providers
- Ollama (primary) — auto-detect, dynamic context window, tool support checking
- Anthropic Claude — Messages API with SSE streaming
- OpenAI — also covers LM Studio, vLLM, llama.cpp (OpenAI-compatible)
- Google Gemini — streaming with function calling
- Provider router with fallback chain and local server auto-detection
- Reasoning/thinking content support (Qwen, DeepSeek, etc.)

### Tools (18 total)
- **Core (10):** read_file, write_file, edit_file, list_directory, search_files, glob_files, bash, git, web_search (Brave), web_fetch
- **Self-config (8):** config, manage_channel, manage_agent, manage_model, manage_session, manage_cron, gateway_status, send_message

### Interfaces
- **CLI:** 12 commands — chat, harness, setup, fix, models, agents, daemon, tui, dashboard, pipeline, cron, channels
- **TUI:** Rich terminal UI with streaming, tool cards, thinking blocks, agent/session/model pickers, slash commands, shell integration
- **Web Control UI:** 8-panel SPA — Chat, Agents, Sessions, Config (JSON editor), Pipelines, Cron, Logs, Channels
- **Telegram:** Full adapter with slash commands, typing indicators, response chunking, permission allowlists, group mention checking
- **Discord:** Full adapter with typing, reply threading, response chunking

### Multi-Agent
- Named agents with separate models, workspaces, and tool access
- Config-driven routing with binding priority tiers (peer → guild → team → channel → default)
- Normalized session keys for cross-channel continuity (dm:telegram:123, cli:main, etc.)

### Systems
- **Memory:** TF-IDF cosine similarity with decay scoring, categorized storage (identity/knowledge/lessons/context)
- **Sessions:** JSON transcript persistence, prune/cap/reset, cross-channel shared sessions
- **Config:** JSON5 with env var substitution, hot-reload watcher, defaults with deep merge
- **Cron:** JSONL job store, 30s tick interval, run logging, retry tracking
- **Pipelines:** Sequential step execution with agent handoffs, state persistence
- **Plugins:** Discovery (~/.clank/plugins/ + node_modules/clank-plugin-*), 25+ hook types
- **Heartbeat:** Periodic probes from HEARTBEAT.md, quiet hours
- **Voice:** TTS (ElevenLabs + piper), STT (whisper.cpp)
- **Daemon:** Cross-platform service — macOS (launchd), Windows (Task Scheduler), Linux (systemd)

### Security
- AES-256-GCM encryption for API keys (PBKDF2, 100K iterations)
- PIN verification with timing-safe comparison
- 3-tier tool safety system (low/medium/high) with auto-approve settings
- Harness binds to localhost by default, token-based auth

### Onboarding
- `clank setup` wizard — Quick Start (under 2 minutes) and Advanced flows
- Auto-detects local model servers (Ollama, LM Studio, llama.cpp, vLLM)
- Configures cloud providers, Telegram, Discord, Brave Search, voice, agents
- `clank fix` diagnostics with auto-repair

### Workspace
- Bootstrap templates: SOUL.md, USER.md, IDENTITY.md, BOOTSTRAP.md, AGENTS.md, TOOLS.md, MEMORY.md, HEARTBEAT.md
- System prompt builder loads workspace files + project context (.clank.md)
