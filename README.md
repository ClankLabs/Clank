# Clank

> Local-first AI agent gateway. Open-source alternative to OpenClaw, optimized for local models.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](https://github.com/ItsTrag1c/Clank/releases/tag/v1.1.0)

## What is Clank?

Clank is a personal AI gateway — a single daemon that connects your preferred interfaces (CLI, browser, Telegram, Discord) to AI agents running local or cloud models. One gateway, many frontends, all equal.

**Built for people who want the OpenClaw experience without the token costs.**

## Features

- **Local-first** — Auto-detects Ollama, LM Studio, llama.cpp, vLLM. Cloud providers optional.
- **Multi-agent** — Named agents with separate models, workspaces, and tools
- **Multi-channel** — CLI, TUI, Web UI, Telegram, Discord — all equal interfaces
- **Self-configuring** — After initial setup, configure everything through conversation
- **18 tools** — File ops, bash, git, web search, plus 8 self-config tools
- **Web Control UI** — 8-panel dashboard (Chat, Agents, Sessions, Config, Pipelines, Cron, Logs, Channels)
- **Pipeline orchestration** — Chain agents together for complex workflows
- **Plugin system** — Extend with custom tools, channels, and providers (25+ hook types)
- **Cron scheduler** — Scheduled and recurring agent tasks
- **Voice support** — Cloud (ElevenLabs) or fully local (whisper.cpp + piper)
- **File-based storage** — JSON/JSONL/Markdown. Inspectable, editable, no database.

## Quick Start

```bash
npm install -g clank
clank setup
```

Setup auto-detects local models, configures the gateway, and gets you chatting in under 2 minutes.

## Architecture

```
              ┌─────────────────────────────┐
              │       Clank Gateway          │
              │     (single daemon)          │
              │                              │
              │  Agent Pool + Routing        │
              │  Sessions, Memory, Pipelines │
              │  Cron, Tools, Plugins        │
              └──────────────┬───────────────┘
                             │
                WebSocket + HTTP (port 18790)
                             │
      ┌──────────┬───────────┼───────────┬──────────┐
      │          │           │           │          │
  clank CLI  Web UI     Telegram    Discord    TUI
  (direct)  (browser)    (bot)      (bot)   (terminal)
```

One gateway, many frontends. All share sessions, memory, and pipeline state. The gateway runs in the background — Telegram/Discord stay alive while you use CLI/TUI/Web on demand.

## Commands

```bash
# Default — start gateway + TUI
clank                         # Start gateway in background, open TUI

# Chat interfaces
clank chat                    # CLI chat (direct mode, no gateway needed)
clank chat --web              # Start gateway + open Web UI in browser
clank tui                     # TUI connecting to gateway
clank dashboard               # Open Web UI in browser

# Gateway management
clank gateway start           # Start gateway in background
clank gateway stop            # Stop gateway
clank gateway status          # Show status, clients, sessions
clank gateway restart         # Stop + start

# Configuration
clank setup                   # Onboarding wizard
clank fix                     # Diagnostics & auto-repair
clank models list             # List available models
clank models add              # Add a provider (Anthropic, OpenAI, Google, Brave)
clank models test             # Test model connectivity
clank agents list             # List configured agents
clank agents add              # Add a new agent

# Scheduled tasks
clank cron list               # List cron jobs
clank cron add                # Add a scheduled job
clank pipeline list           # List pipelines

# System
clank daemon install          # Install as system service (auto-start at login)
clank daemon status           # Service status
clank channels                # Show channel adapter status
clank uninstall               # Remove everything (config, data, service, package)
```

## Security

- **Workspace containment** — file tools cannot access paths outside the workspace
- **Tool safety levels** — 3-tier system (low/medium/high) with configurable auto-approve
- **Bash protection** — 25-pattern blocklist for destructive commands, defense in depth
- **API key encryption** — AES-256-GCM with PBKDF2 key derivation (100K iterations)
- **Config redaction** — API keys never sent to LLM context or WebSocket clients
- **SSRF protection** — web_fetch blocks localhost, cloud metadata, internal hostnames
- **Gateway auth** — token-based, auto-generated if missing, localhost-only by default
- **Prototype pollution protection** — blocked on config.set RPC
- See [SECURITY.md](SECURITY.md) for full details

## Requirements

- Node.js 20+
- A local model server (Ollama recommended) or cloud API key

## Links

- **Website:** [clanksuite.dev](https://clanksuite.dev)
- **Legacy:** [Clank-Legacy](https://github.com/ItsTrag1c/Clank-Legacy) (archived CLI v2.7.0 + Desktop v2.6.1)

## License

MIT
