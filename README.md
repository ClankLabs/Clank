<p align="center">
  <img src="https://raw.githubusercontent.com/ItsTrag1c/Clank/main/docs/banner.png" alt="Clank" width="100%" />
</p>

<h1 align="center">Clank</h1>

<p align="center">
  <b>Local-first AI agent gateway.</b> Open-source alternative to OpenClaw, optimized for local models.
</p>

<p align="center">
  <a href="https://github.com/ItsTrag1c/Clank/releases/latest"><img src="https://img.shields.io/badge/version-1.4.3-blue.svg" alt="Version" /></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" /></a>
  <a href="https://www.npmjs.com/package/@tractorscorch/clank"><img src="https://img.shields.io/npm/v/@tractorscorch/clank.svg" alt="npm" /></a>
  <a href="https://github.com/ItsTrag1c/Clank/stargazers"><img src="https://img.shields.io/github/stars/ItsTrag1c/Clank.svg" alt="Stars" /></a>
</p>

<p align="center">
  <a href="https://clanksuite.dev">Website</a> ·
  <a href="https://github.com/ItsTrag1c/Clank/blob/main/docs/INSTALL.md">Install Guide</a> ·
  <a href="https://github.com/ItsTrag1c/Clank/blob/main/docs/USER_GUIDE.md">User Guide</a> ·
  <a href="https://github.com/ItsTrag1c/Clank/blob/main/CHANGELOG.md">Changelog</a> ·
  <a href="https://x.com/ClankSuite">Twitter</a> ·
  <a href="https://reddit.com/u/ClankSuite">Reddit</a>
</p>

---

## What is Clank?

Clank is a personal AI gateway — **one daemon, many frontends**. It connects your preferred interfaces (CLI, TUI, browser, Telegram, Discord) to AI agents running local or cloud models. All interfaces share sessions, memory, and agent state.

**Built for people who want the OpenClaw experience without the token costs.**

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
     CLI      Web UI     Telegram    Discord      TUI
  (direct)  (browser)    (bot)       (bot)     (terminal)
```

## Quick Start

### npm (all platforms)

```bash
npm install -g @tractorscorch/clank
clank setup
clank
```

### macOS (standalone binary)

```bash
curl -fsSL https://raw.githubusercontent.com/ItsTrag1c/Clank/main/install.sh | bash
clank setup
clank
```

That's it. Setup auto-detects your local models, configures the gateway, and gets you chatting in under 2 minutes. See the [full install guide](docs/INSTALL.md) for details.

### Downloads

| Platform | Download |
|----------|----------|
| **npm** (all platforms) | `npm install -g @tractorscorch/clank` |
| **macOS** (Apple Silicon) | [Clank_1.4.3_macos](https://github.com/ItsTrag1c/Clank/releases/latest/download/Clank_1.4.3_macos) |

## Features

| Feature | Description |
|---------|-------------|
| **Local-first** | Auto-detects Ollama, LM Studio, llama.cpp, vLLM. Cloud providers optional. |
| **Multi-agent** | Named agents with separate models, workspaces, tools, and routing. |
| **Multi-channel** | CLI, TUI, Web UI, Telegram, Discord — all equal, all share sessions. |
| **Self-configuring** | After setup, configure everything through conversation. |
| **18 tools** | File ops, bash, git, web search (Brave), plus 8 self-config tools. |
| **Web Control UI** | 8-panel dashboard: Chat, Agents, Sessions, Config, Pipelines, Cron, Logs, Channels. |
| **Pipeline orchestration** | Chain agents together for multi-step workflows. |
| **Plugin system** | Extend with custom tools, channels, and providers. 25+ hook types. |
| **Cron scheduler** | Recurring and one-shot scheduled agent tasks. |
| **Voice** | Cloud (ElevenLabs) or fully local (whisper.cpp + piper). |
| **Memory** | TF-IDF with decay scoring. Agent learns and remembers across sessions. |
| **Security** | AES-256-GCM encryption, SSRF protection, path containment, config redaction. |

## Commands

```bash
# Start — gateway + TUI (Telegram/Discord stay alive in background)
clank

# Chat interfaces
clank chat                    # Direct mode (no gateway needed)
clank chat --web              # Auto-start gateway + open Web UI
clank tui                     # Rich TUI connected to gateway
clank dashboard               # Open Web UI in browser

# Gateway
clank gateway start           # Start in background
clank gateway stop            # Stop
clank gateway status          # Show status, clients, sessions
clank gateway restart         # Restart

# Setup & diagnostics
clank setup                   # Onboarding wizard
clank fix                     # Diagnostics & auto-repair

# Model & agent management
clank models list             # Detect + list models
clank models add              # Add a provider (Anthropic, OpenAI, Google, Brave)
clank models test             # Test connectivity
clank agents list             # List agents
clank agents add              # Create an agent

# Scheduled tasks
clank cron list               # List jobs
clank cron add                # Schedule a task

# System
clank daemon install          # Auto-start at login (Windows/macOS/Linux)
clank channels                # Channel status
clank uninstall               # Remove everything
```

## Providers

| Provider | Type | How |
|----------|------|-----|
| **Ollama** | Local | Auto-detected at `localhost:11434` |
| **LM Studio** | Local | Auto-detected at `localhost:1234` |
| **llama.cpp** | Local | Auto-detected at `localhost:8080` |
| **vLLM** | Local | Auto-detected at `localhost:8000` |
| **Anthropic** | Cloud | API key via `clank setup` or config |
| **OpenAI** | Cloud | API key via `clank setup` or config |
| **Google Gemini** | Cloud | API key via `clank setup` or config |

Models without native tool calling automatically use prompt-based fallback — tools are injected into the system prompt and parsed from text output.

## Security

Clank is designed to be safe by default:

- **Workspace containment** — file tools blocked outside workspace
- **Bash protection** — 25-pattern blocklist for destructive commands
- **API key redaction** — keys never sent to LLM context
- **SSRF protection** — web_fetch blocks localhost, cloud metadata, internal hosts
- **Gateway auth** — token-based, auto-generated, localhost-only by default
- **Encryption** — AES-256-GCM for API keys at rest

See [SECURITY.md](SECURITY.md) for the full security model.

## Documentation

- **[Install Guide](docs/INSTALL.md)** — Detailed installation and setup instructions
- **[User Guide](docs/USER_GUIDE.md)** — How to use Clank day-to-day
- **[Changelog](CHANGELOG.md)** — Version history
- **[Privacy Policy](PRIVACY_POLICY.md)** — Data handling
- **[Security Policy](SECURITY.md)** — Security model and vulnerability reporting

## Links

| | |
|--|--|
| **Website** | [clanksuite.dev](https://clanksuite.dev) |
| **GitHub** | [ItsTrag1c/Clank](https://github.com/ItsTrag1c/Clank) |
| **npm** | [npmjs.com/package/@tractorscorch/clank](https://www.npmjs.com/package/@tractorscorch/clank) |
| **Twitter/X** | [@ClankSuite](https://x.com/ClankSuite) |
| **Reddit** | [u/ClankSuite](https://reddit.com/u/ClankSuite) |
| **Legacy** | [Clank-Legacy](https://github.com/ItsTrag1c/Clank-Legacy) (archived CLI v2.7.0 + Desktop v2.6.1) |

## Requirements

- Node.js 20+
- A local model server (Ollama recommended) or cloud API key

## License

MIT — see [LICENSE](LICENSE)
