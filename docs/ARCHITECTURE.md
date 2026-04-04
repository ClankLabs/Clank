# Architecture

Technical reference for the Clank Gateway internals.

> **Deployment Note:** Clank is designed to run on dedicated hardware (dev machine, VM, or container) due to its full system access model. See the [Threat Model](THREAT_MODEL.md) for detailed security considerations.

---

## Overview

Clank Gateway is a single-daemon AI agent gateway that exposes both WebSocket and HTTP interfaces on port **18790**. All communication uses JSON-RPC 2.0. One process handles every connected channel, every active agent, and every tool invocation.

```
                          ┌───────────────────┐
                          │   Clank Gateway    │
                          │   (port 18790)     │
                          └─────────┬──────────┘
                                    │
               ┌────────────────────┼────────────────────┐
               │                    │                    │
          WebSocket              HTTP              Adapters
         (real-time)           (REST)        (Telegram, Discord,
                                              Signal, Web, CLI, TUI)
               │                    │                    │
               └────────────────────┼────────────────────┘
                                    │
                           ┌────────┴────────┐
                           │   AgentEngine   │
                           │   (ReAct loop)  │
                           └────────┬────────┘
                                    │
                     ┌──────────────┼──────────────┐
                     │              │              │
               ContextEngine   ToolRouter    ProviderRouter
               (compaction,    (23 tools)    (8 providers)
                budgeting)
                     │
               MemoryEngine
               (TF-IDF, decay)
```

The gateway is stateful per-session. Each session tracks its own conversation history, context window, and active agent configuration.

---

## Engine

### AgentEngine (ReAct Loop)

The core execution model is ReAct: **Reason, Act, Observe, Repeat.**

1. **Reason** — the model receives conversation history plus context and decides what to do
2. **Act** — if the model emits a tool call, the gateway executes it
3. **Observe** — the tool result is appended to the conversation
4. **Repeat** — the loop continues until the model produces a final text response or hits an iteration limit

This loop powers every interaction regardless of which interface it arrives from.

### ContextEngine (Two-Tier Compaction)

Context windows are finite. The ContextEngine manages what stays and what gets compressed.

**Tier 1 — Mechanical compaction.** Old messages are truncated deterministically: tool results get trimmed, verbose outputs get cut to a summary line. Fast, no LLM call required.

**Tier 2 — LLM-summarized compaction.** When tier 1 isn't enough, the engine asks the model to summarize older conversation segments. Preserves semantic meaning while dramatically reducing token count.

### Token Budgeting

Every message sent to the provider is budgeted against the model's context limit. The engine tracks token usage across system prompt, memory injections, conversation history, and pending tool results.

### Proactive Auto-Compaction

Compaction triggers in three scenarios:

1. **Post-tool** — after every tool result, checks if context is getting heavy
2. **Pre-send safety (90%)** — before any provider request, if context exceeds 90% of the model's limit
3. **Context error recovery** — if a provider returns a context-length error, compacts aggressively and retries

---

## Providers

Eight provider adapters, all implementing the same interface:

| Provider | Connects to | Notes |
|----------|-------------|-------|
| **Ollama** | Local Ollama instance | Default for local models, auto-detected |
| **Anthropic** | Claude API | Streaming, native tool use |
| **OpenAI** | OpenAI API | GPT-4o, o-series, etc. |
| **OpenAI (compatible)** | LM Studio, vLLM, llama.cpp | Any OpenAI-compatible endpoint |
| **Google Gemini** | Gemini API | Native function calling |
| **OpenRouter** | OpenRouter | Multi-model routing via one key |
| **OpenCode** | OpenCode servers | Subscription-based access |
| **Codex** | OpenAI Codex (OAuth) | Uses ChatGPT Plus/Pro subscription |

**PromptFallbackProvider** wraps any provider whose models lack native tool calling. It injects tool definitions into the system prompt and parses structured output from the model's text response. This is how every local model gets full tool support automatically.

---

## Tools

### Core Tools (10)

Available at all tool tiers (core, auto, full):

| Tool | Purpose |
|------|---------|
| `read_file` | Read file contents with line numbers |
| `write_file` | Write or overwrite a file |
| `edit_file` | Surgical string replacement in files |
| `list_directory` | List files and directories |
| `bash` | Execute shell commands |
| `search_files` | Regex search across files |
| `glob_files` | Find files by glob pattern |
| `git` | Git operations (status, diff, commit, log, etc.) |
| `web_search` | Search the web via Brave Search API |
| `web_fetch` | Fetch and extract content from URLs (HTML auto-converted to readable text) |

### Self-Configuration Tools (9)

Let the agent modify its own configuration at runtime — switching models, adjusting behavior, managing agents, creating cron jobs. The agent can reconfigure itself through conversation.

### Voice Tools (3)

Text-to-speech (ElevenLabs), speech-to-text (Whisper/Groq), and voice listing for voice interaction support.

### File Tool (1)

File sharing for Telegram document uploads and cross-channel file transfer.

### Tool Tiers

| Tier | Tools | Best for |
|------|-------|----------|
| `full` | All 23 tools | Capable models (Claude, GPT-4o, Wrench 35B) |
| `auto` | 10 core + dynamic additions based on keywords | Smart default for local models |
| `core` | 10 core tools | Smaller models that get confused with too many tools |

---

## Channels

### Telegram (grammY)

Full bot integration with streaming, inline tool approvals (InlineKeyboard with Approve / Always / Deny), voice messages, photo/document handling, slash commands, per-chat thinking toggle, and tool emoji indicators. Each chat maps to a Clank session.

### Discord (discord.js)

Bot with streaming, inline tool approvals (ActionRow with Button components), slash commands, and thread support. Each channel or thread maps to a session.

### Signal (signal-cli)

Integration via signal-cli JSON-RPC daemon. DM and group support, phone number allowlist, slash commands, tool indicators. Zero new npm dependencies. Auto-approves tools (no interactive button API).

### Web UI (8-Panel SPA)

Local single-page application: Chat, Agents, Sessions, Config, Pipelines, Cron, Logs, Channels. Connects to the gateway over WebSocket.

### CLI

Direct terminal REPL via `clank chat`. Supports streaming responses, tool call display, and session management. No gateway required.

### TUI

Rich terminal UI via `clank tui` with panels, scrolling history, tool cards, thinking blocks, and slash commands.

### Shared Command Handler

All adapters (Telegram, Discord, Signal) share a unified command handler (`src/adapters/commands.ts`). Utility functions like `toolEmoji()` and `splitMessage()` are shared across all adapters.

---

## Multi-Agent

- **Config-driven routing** — each agent defined in config with its own model, system prompt, and tool access
- **Per-agent model assignment** — one agent can use Claude, another Ollama, another GPT-4o
- **Sub-agent spawning** — agents spawn sub-agents for background tasks with depth control and concurrent limits (default: 8 max)
- **Parent-child tree** — sub-agents report to their parent; parent can kill, steer, or message children
- **Cascade kill** — killing a parent kills all descendants

---

## Memory

**TF-IDF cosine similarity with decay scoring** surfaces relevant memories.

- **Auto-persistence** — memories saved automatically as conversations progress
- **Decay scoring** — older memories lose relevance weight over time
- **Smart injection for local models** — instead of injecting the full MEMORY.md (wastes tokens), the engine runs relevance matching and injects only memories that score above a threshold
- **Plain files on disk** — no database, no external service

---

## Sessions

- **Cross-channel normalized keys** — the same conversation tracked across channels
- **JSON persistence** — sessions saved as JSON with conversation history, compacted context, active agent state, and metadata
- **Per-channel queuing** — messages from the same chat are processed sequentially to prevent race conditions

---

## Security

| Layer | Implementation |
|-------|---------------|
| **Bash blocklist** | 32 patterns matching destructive commands |
| **Config redaction** | API keys and secrets never exposed through RPC or tool outputs |
| **SSRF protection** | Blocks private IPs, link-local, metadata endpoints, IPv6 equivalents |
| **AES-256-GCM** | Stored credentials encrypted at rest |
| **Rate limiting** | 20 requests per minute per session |
| **Path containment** | `guardPath()` prevents traversal outside workspace |
| **System file protection** | Agent won't modify files outside workspace unless user explicitly names them |
| **Prototype pollution** | `__proto__`, `constructor`, `prototype` blocked on all input |
| **Supply chain** | All deps pinned to exact versions, lockfile committed, npm 2FA |

See [THREAT_MODEL.md](THREAT_MODEL.md) for a full assessment including known limitations.

---

## Config

Configuration lives at:
- **Windows:** `%APPDATA%\Clank\config.json5`
- **macOS / Linux:** `~/.clank/config.json5`

**JSON5 format** — supports comments, trailing commas, unquoted keys, multi-line strings.

**Environment variable substitution** — `${ENV_VAR}` resolved at startup.

**Hot-reload** — the gateway watches the config file. Changes take effect without restart.
