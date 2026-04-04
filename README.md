<p align="center">
  <img src="https://raw.githubusercontent.com/ClankLabs/Clank/main/docs/banner.png" alt="Clank" width="100%" />
</p>

<h1 align="center">Clank</h1>

<p align="center">
  <b>Local-first AI agent harness.</b><br />
  One daemon. Every interface. Your models, your machine, your data.
</p>

<p align="center">
  <a href="https://github.com/ClankLabs/Clank/releases/latest"><img src="https://img.shields.io/badge/version-1.11.3-blue.svg" alt="Version" /></a>
  <a href="https://www.apache.org/licenses/LICENSE-2.0"><img src="https://img.shields.io/badge/License-Apache%202.0-blue.svg" alt="License" /></a>
  <a href="https://www.npmjs.com/package/@clanklabs/clank"><img src="https://img.shields.io/npm/v/@clanklabs/clank.svg" alt="npm" /></a>
  <a href="https://github.com/ClankLabs/Clank/stargazers"><img src="https://img.shields.io/github/stars/ClankLabs/Clank.svg" alt="Stars" /></a>
</p>

<p align="center">
  <a href="https://clanklabs.dev">Website</a> &middot;
  <a href="https://github.com/ClankLabs/Clank/blob/main/docs/INSTALL.md">Install</a> &middot;
  <a href="https://github.com/ClankLabs/Clank/blob/main/docs/USER_GUIDE.md">User Guide</a> &middot;
  <a href="https://github.com/ClankLabs/Clank/blob/main/CHANGELOG.md">Changelog</a> &middot;
  <a href="https://x.com/Clank_Labs">Twitter</a> &middot;
  <a href="https://reddit.com/u/ClankLabs">Reddit</a>
</p>

---

## What is Clank?

Clank is a personal AI harness that connects your preferred interfaces to AI agents running local or cloud models. One daemon runs in the background; every interface — CLI, TUI, browser, Telegram, Discord, Signal — shares sessions, memory, and agent state.

```
                ┌──────────────────────────────┐
                │        Clank Gateway          │
                │       (single daemon)         │
                │                               │
                │   Agent Pool + Routing        │
                │   Sessions, Memory, Tools     │
                │   Pipelines, Cron, Plugins    │
                └──────────────┬────────────────┘
                               │
                  WebSocket + HTTP (port 18790)
                               │
     ┌──────┬──────┬───────────┼───────────┬──────┬──────┐
     │      │      │           │           │      │      │
    CLI    TUI   Web UI    Telegram    Discord  Signal  API
```

## Quick Start

### npm (all platforms)

```bash
npm install -g @clanklabs/clank
clank setup
clank
```

### macOS / Linux (one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/ClankLabs/Clank/main/install.sh | bash
clank setup
clank
```

That's it. Setup auto-detects local models, configures the harness, and gets you chatting in under 2 minutes. See the [Install Guide](docs/INSTALL.md) for platform-specific instructions — [Windows](docs/INSTALL-WINDOWS.md) | [macOS](docs/INSTALL-MACOS.md) | [Linux](docs/INSTALL-LINUX.md).

## Security Notice

Clank is a **developer tool** that gives AI agents full access to your file system, shell, and connected services. **We strongly recommend running Clank on dedicated hardware** (a dev machine, VM, or container) rather than on a system with sensitive personal files or credentials.

---

## Wrench — Purpose-Built Agentic Models

[**Wrench**](https://clanklabs.dev/wrench) is our family of fine-tuned models built specifically for Clank's tool calling protocol. All training data is [published and auditable](https://github.com/ClankLabs/wrench-training-data).

| Model | Clank Benchmark | BFCL (non_live) | Base | VRAM | Download |
|-------|----------------|-----------------|------|------|----------|
| **Wrench 35B** | 118/120 (98%) | 82.0% | Qwen3.5-35B-A3B (MoE) | 16GB | [HuggingFace](https://huggingface.co/ClankLabs/Wrench-35B-A3B-Q4_K_M-GGUF) |
| **Wrench 9B** | 114/120 (95%) | — | Qwen3.5-9B (dense) | 8GB | [HuggingFace](https://huggingface.co/ClankLabs/Wrench-9B-Q4_K_M-GGUF) |

```bash
# Ollama
ollama create wrench -f Modelfile
# Set as primary model: "primary": "ollama/wrench"

# llama.cpp
./llama-server -m wrench-35B-A3B-Q4_K_M.gguf --jinja -ngl 100 -fa on \
  --cache-type-k q8_0 --cache-type-v q8_0 \
  --temp 0.4 --top-k 20 --top-p 0.95 --min-p 0 --presence-penalty 1.5 -c 32768
```

---

## Features

| | |
|---|---|
| **Local-first** | Auto-detects Ollama, LM Studio, llama.cpp, vLLM. Cloud providers optional. |
| **8 providers** | Ollama, Anthropic, OpenAI, Google Gemini, OpenRouter, OpenCode, Codex (OAuth), and automatic prompt fallback for models without native tool calling. |
| **6 interfaces** | CLI, TUI, Web UI, Telegram, Discord, Signal — all equal citizens, all share sessions and memory. |
| **25 tools** | File ops, bash, git, web search, web fetch, doc search (RAG), plus 10 self-config tools (including health diagnostics), 3 voice tools, and file sharing. |
| **Multi-agent** | Named agents with separate models, workspaces, tools, and routing. Spawn background sub-agents with depth control. |
| **Inline approvals** | Telegram and Discord show Approve / Always / Deny buttons for tool confirmations. Signal and CLI auto-approve. |
| **Web dashboard** | 8-panel SPA: Chat, Agents, Sessions, Config, Pipelines, Cron, Logs, Channels. |
| **Pipelines** | Chain agents together for multi-step workflows. |
| **Cron** | Recurring and one-shot scheduled agent tasks. |
| **Plugins** | Extend with custom tools, channels, and providers. 25+ hook types. |
| **Voice** | ElevenLabs TTS, Groq/OpenAI/local Whisper STT. Telegram voice messages. |
| **Memory** | TF-IDF with decay scoring. The agent learns and remembers across sessions. |
| **Self-configuring** | After setup, configure everything through conversation — models, channels, agents, cron jobs. |
| **Security** | AES-256-GCM encryption, SSRF protection, bash blocklist, path containment, config redaction, rate limiting. |

---

## Commands

```bash
# Daily use
clank                         # Start harness + TUI (recommended)
clank chat                    # Direct CLI chat (no harness needed)
clank chat --web              # Start harness + open Web UI
clank tui                     # Rich TUI connected to harness
clank dashboard               # Open Web UI in browser

# Harness management
clank gateway start           # Start in background
clank gateway stop            # Stop
clank gateway status          # Show status, clients, sessions
clank gateway restart         # Restart

# Setup & diagnostics
clank setup                   # Onboarding wizard
clank setup --advanced        # Full control over every setting
clank fix                     # Diagnostics & auto-repair

# Models & agents
clank models list             # Detect + list all available models
clank models add              # Add a provider (Anthropic, OpenAI, etc.)
clank models test             # Test provider connectivity
clank agents list             # List configured agents
clank agents add              # Create a new agent

# Scheduling
clank cron list               # List scheduled jobs
clank cron add                # Schedule a recurring task

# System
clank daemon install          # Auto-start at login (Windows/macOS/Linux)
clank daemon status           # Check daemon status
clank channels                # Channel adapter status
clank auth login              # OAuth login (Codex)
clank update                  # Update to latest version
clank uninstall               # Remove everything
```

---

## Providers

| Provider | Type | Detection |
|----------|------|-----------|
| **Ollama** | Local | Auto-detected at `localhost:11434` |
| **LM Studio** | Local | Auto-detected at `localhost:1234` |
| **llama.cpp** | Local | Auto-detected at `localhost:8080` |
| **vLLM** | Local | Auto-detected at `localhost:8000` |
| **Anthropic** | Cloud | API key via `clank setup` or config |
| **OpenAI** | Cloud | API key via `clank setup` or config |
| **Google Gemini** | Cloud | API key via `clank setup` or config |
| **OpenRouter** | Cloud | API key via `clank setup` or config |

Models without native tool calling automatically use prompt-based fallback — tools are injected into the system prompt and parsed from text output. Every local model gets tool support out of the box.

---

## Security

| Layer | Protection |
|-------|------------|
| **Workspace containment** | File tools blocked outside workspace via `guardPath()` |
| **Bash blocklist** | 32 patterns covering destructive commands (`rm -rf`, `mkfs`, fork bombs, nested shells, interpreter escapes, etc.) |
| **API key redaction** | Keys never sent to LLM context or exposed via RPC |
| **SSRF protection** | `web_fetch` blocks localhost, private IPs, cloud metadata, internal hosts |
| **Harness auth** | Token-based, auto-generated, localhost-only by default |
| **Encryption** | AES-256-GCM for API keys at rest (PBKDF2, 100K iterations) |
| **Rate limiting** | 20 requests/min/session by default |
| **Supply chain** | All deps pinned to exact versions, lockfile committed, npm 2FA |

See [SECURITY.md](SECURITY.md) for the full security model and [THREAT_MODEL.md](docs/THREAT_MODEL.md) for an honest assessment of limitations.

---

## Documentation

| Document | Description |
|----------|-------------|
| **[Install Guide](docs/INSTALL.md)** | Installation and setup — with per-OS guides for [Windows](docs/INSTALL-WINDOWS.md), [macOS](docs/INSTALL-MACOS.md), and [Linux](docs/INSTALL-LINUX.md) |
| **[User Guide](docs/USER_GUIDE.md)** | Day-to-day usage, commands, multi-agent, background tasks, memory |
| **[Architecture](docs/ARCHITECTURE.md)** | Engine, providers, tools, channels, security internals |
| **[Changelog](CHANGELOG.md)** | Full version history |
| **[Security Policy](SECURITY.md)** | Security model and vulnerability reporting |
| **[Privacy Policy](PRIVACY_POLICY.md)** | Data handling (spoiler: we collect nothing) |
| **[Threat Model](docs/THREAT_MODEL.md)** | What we defend against and what we don't |
| **[Training](docs/TRAINING.md)** | Wrench model training methodology and data |
| **[Benchmark](docs/BENCHMARK.md)** | 40-prompt agentic evaluation suite |
| **[Alignment](docs/ALIGNMENT.md)** | How we think about AI safety and transparency |
| **[Contributing](CONTRIBUTING.md)** | How to contribute code, training data, or bug reports |

---

## Requirements

- **Node.js 20+** — [nodejs.org](https://nodejs.org/)
- **A local model server** (Ollama recommended) or a cloud API key

## Links

| | |
|--|--|
| **Website** | [clanklabs.dev](https://clanklabs.dev) |
| **npm** | [@clanklabs/clank](https://www.npmjs.com/package/@clanklabs/clank) |
| **GitHub** | [ClankLabs/Clank](https://github.com/ClankLabs/Clank) |
| **Twitter/X** | [@Clank_Labs](https://x.com/Clank_Labs) |
| **Reddit** | [u/ClankLabs](https://reddit.com/u/ClankLabs) |

## License

Apache 2.0 — see [LICENSE](LICENSE)
