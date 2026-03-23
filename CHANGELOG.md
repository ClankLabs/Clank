# Changelog

All notable changes to Clank will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/).

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
- **Tool calling crashes gateway** — context compaction could split tool call / tool result message pairs, sending orphaned messages to Ollama which returns 400 errors and corrupts the session permanently; compaction now drops complete pairs together
- **Orphaned tool result safety net** — Ollama provider now filters out orphaned tool results before sending to the API, preventing 400 errors even if compaction misses a pair

---

## [1.4.6] — 2026-03-22

### Fixed
- **Telegram stutter (for real)** — when the model responds fast, the initial `sendMessage` promise hasn't resolved by the time the full response is ready, causing a duplicate message via the fallback path; now waits for the in-flight message ID before falling back

---

## [1.4.5] — 2026-03-22

### Fixed
- **Gateway unresponsive after messages** — WebSocket frame handler was not awaited, causing unhandled promise rejections that silently killed the gateway process
- **Added `unhandledRejection` handler** — gateway now logs rejected promises instead of dying silently
- **Provider timeout fallback** — all providers (Ollama, Anthropic, OpenAI, Google) now have a fallback timeout (120s local, 90s cloud) if no abort signal is provided, preventing indefinite hangs when a model is unresponsive

---

## [1.4.4] — 2026-03-22

### Fixed
- **Gateway crash after 4-5 messages** — confirmation handler WebSocket listeners were never removed on timeout, accumulating orphaned handlers per message until the process crashed
- **Engine listener limit** — set `maxListeners` to 30 on AgentEngine (Node.js default of 10 was too low since each message cycle wires 10 event listeners)
- **Rate limiter memory leak** — stale session entries in the rate limiter Map were never purged; added periodic cleanup when map exceeds 100 entries

---

## [1.4.3] — 2026-03-22

### Fixed
- **Telegram streaming stutter** — fixed race condition where multiple partial messages were sent instead of editing a single message; added synchronous guard flag to prevent duplicate `sendMessage` calls while the initial message promise is in-flight
- **Gateway killed by `clear` on Windows** — replaced `fork()` with `spawn()` + `windowsHide` for background gateway process; `fork` kept an IPC channel tied to the parent console, so clearing PowerShell killed the gateway
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
- **Gateway crash on restart** — stale Telegram messages queued while offline no longer flood the model. Messages older than 30s before startup are dropped.
- **Parallel model overload** — Telegram messages from the same chat are now processed sequentially (per-chat queue) instead of all at once.

---

## [1.2.0] — 2026-03-22

### Added
- **Two-tier context compaction** — critical for local model performance:
  - Tier 1 (fast): system prompt budgeting, tool result dedup, message truncation, aggressive dropping
  - Tier 2 (LLM-summarized): model generates conversation recap replacing oldest messages. Preserves meaning over long sessions.
  - Token budgeting: reserves 25% for response, budgets system prompt separately from conversation
- **`clank update`** — update to latest npm version, preserves config/sessions/memory, restarts gateway

---

## [1.1.0] — 2026-03-22

### Security Hardening
- **Bash tool:** expanded blocklist from 5 to 25 patterns — covers flag variations, shell-in-shell, encoded payloads, PowerShell, system damage commands
- **Path traversal:** all file tools (read, write, edit, list, search, glob) now enforce workspace containment via `guardPath()` — blocks absolute paths and `../` traversal outside workspace
- **Config redaction:** API keys, bot tokens, and auth tokens are stripped from config before exposing to LLM context or WebSocket clients
- **Prototype pollution:** config.set RPC blocks `__proto__`, `constructor`, `prototype` keys
- **SSRF protection:** web_fetch blocks localhost, cloud metadata endpoints (169.254.169.254), .internal/.local hostnames, file:// protocol
- **Gateway auth:** auto-generates token on startup if mode is "token" but no token configured — prevents accidental open gateways
- **Status endpoint:** /status now requires Bearer token authentication
- **Tool confirmations:** gateway respects autoApprove config instead of blindly approving — 30s timeout defaults to deny
- **.gitignore:** added config.json5, *.pem, *.key, credentials.json to prevent accidental secret commits

### Bug Fixes
- **Telegram bot not responding:** `bot.start()` was blocking (awaited) which prevented the gateway from finishing startup. Now runs non-blocking with `onStart` callback.
- **Telegram allowFrom:** now matches both `@username` and numeric user IDs (was only matching numeric)
- **grammY missing:** added as real dependency (was dynamic import that failed silently)
- **Local server URL not saved:** setup wizard now saves detected server baseUrl for all local providers (was only saving Ollama)
- **Port conflict:** default port changed to 18790 (was 18789, conflicted with OpenClaw/Claude Code)
- **--web flag:** `clank chat --web` now auto-starts gateway and opens browser
- **Gateway text/message param:** accepts both `message` and `text` fields from clients

### Added
- **TUI:** rich terminal UI with streaming, tool cards, thinking blocks, agent/session/model pickers, slash commands, shell integration (`!command`)
- **Web Control UI:** 8-panel dashboard — Chat, Agents, Sessions, Config (JSON editor), Pipelines, Cron, Logs, Channels
- **Telegram slash commands:** /help, /status, /agents, /agent, /sessions, /new, /reset, /model, /think
- **CLI commands:** tui, dashboard, pipeline, cron, channels, uninstall
- **Background gateway:** runs as detached process, Telegram/Discord stay alive while CLI/TUI/Web run on top
- **Gateway singleton:** refuses to start if already running on the port
- **Self-config tools (8):** config, manage_channel, manage_agent, manage_model, manage_session, manage_cron, gateway_status, send_message
- **Google Gemini provider** with streaming and function calling
- **Memory system:** TF-IDF cosine similarity with decay scoring, categorized storage
- **Encryption:** AES-256-GCM for API keys, PIN hashing with timing-safe comparison
- **Web search:** Brave Search API integration
- **Config hot-reload:** watches config.json5 for changes
- **`clank uninstall`:** removes all data, daemon, and npm package

### Changed
- Default command (`clank` with no args) starts gateway in background then launches TUI
- `clank gateway start` now runs in background by default (`--foreground` for blocking mode)
- `clank gateway restart` fully implemented (stop + start)
- Protocol updated to v1 spec with 17 RPC methods and 11 event types

---

## [1.0.0] — 2026-03-22

Initial release — Clank Gateway foundation.

### Architecture
- Single gateway daemon (HTTP + WebSocket on port 18789)
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
- **CLI:** 12 commands — chat, gateway, setup, fix, models, agents, daemon, tui, dashboard, pipeline, cron, channels
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
- Gateway binds to localhost by default, token-based auth

### Onboarding
- `clank setup` wizard — Quick Start (under 2 minutes) and Advanced flows
- Auto-detects local model servers (Ollama, LM Studio, llama.cpp, vLLM)
- Configures cloud providers, Telegram, Discord, Brave Search, voice, agents
- `clank fix` diagnostics with auto-repair

### Workspace
- Bootstrap templates: SOUL.md, USER.md, IDENTITY.md, BOOTSTRAP.md, AGENTS.md, TOOLS.md, MEMORY.md, HEARTBEAT.md
- System prompt builder loads workspace files + project context (.clank.md)
