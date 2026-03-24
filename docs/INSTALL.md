# Clank — Installation Guide

Complete guide to installing and setting up Clank.

> **Security Notice:** Clank is a developer tool that gives AI agents full access to your file system, shell, and connected services. We strongly recommend running it on dedicated hardware (dev machine, VM, or container) rather than on systems with sensitive personal data.

---

## Prerequisites

- **Node.js 20+** — [download](https://nodejs.org/)
- **A local model server** (recommended) or a cloud API key

### Recommended: Install Ollama

[Ollama](https://ollama.com/) is the easiest way to run local models:

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows — download from https://ollama.com/download

# Pull a model
ollama pull qwen3.5
```

Clank also auto-detects **LM Studio**, **llama.cpp**, and **vLLM** if they're running.

---

## Install Clank

### Option 1: npm (all platforms)

```bash
npm install -g @tractorscorch/clank
```

### Option 2: macOS one-liner (standalone binary, no Node.js required)

```bash
curl -fsSL https://raw.githubusercontent.com/ItsTrag1c/Clank/main/install.sh | bash
```

### Option 3: Manual download

Download the latest binary from the [releases page](https://github.com/ItsTrag1c/Clank/releases/latest):

| Platform | File |
|----------|------|
| macOS (Apple Silicon) | `Clank_<version>_macos` |

Place the binary in your PATH (e.g. `/usr/local/bin/clank`) and `chmod +x` it.

### Verify

```bash
clank --version
```

---

## First-Time Setup

Run the setup wizard:

```bash
clank setup
```

### What Setup Does

1. **Detects local models** — scans for Ollama, LM Studio, llama.cpp, vLLM
2. **Configures the primary model** — picks the best available model as default
3. **Cloud providers** (optional) — add multiple providers in a loop:
   - Anthropic (Claude)
   - OpenAI (GPT-4o, Codex)
   - Google (Gemini)
   - OpenRouter (many models via one API key)
   - OpenCode (subscription-based, many models)
   - OpenAI Codex OAuth (use ChatGPT Plus/Pro subscription)
4. **Gateway settings** — port, auth token (auto-generated)
5. **Workspace** — creates SOUL.md, USER.md, IDENTITY.md, and other workspace files
6. **Channels** — connect Telegram bot, Discord bot (optional)
7. **Web search** — Brave Search API key (optional, free tier available)
8. **Integrations** — ElevenLabs TTS, Whisper STT (optional)
9. **Daemon** — install as system service for auto-start at login

### Quick Start vs Advanced

- **Quick Start** (default) — sensible defaults, minimal questions, chatting in ~2 minutes
- **Advanced** (`clank setup --advanced`) — full control over gateway, models, channels, agents, voice

### Re-running Setup

Setup preserves your existing config. API keys and settings you've already configured will be shown and can be kept with a single Enter.

---

## Start Clank

```bash
# Start gateway + open TUI (recommended)
clank

# Or start the gateway in the background
clank gateway start

# Then use any interface:
clank chat          # CLI chat (direct mode)
clank tui           # TUI connected to gateway
clank chat --web    # Web UI in browser
clank dashboard     # Open Web UI
```

### How It Works

1. The gateway starts as a background process on port 18790
2. Telegram/Discord bots connect and stay alive
3. The TUI opens for you to start chatting
4. You can open additional interfaces simultaneously

All interfaces share the same sessions and memory.

---

## Connect Telegram

During setup, or afterward:

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token
4. Run `clank setup` or edit `config.json5`:

```json5
{
  channels: {
    telegram: {
      enabled: true,
      botToken: "YOUR_BOT_TOKEN",
      allowFrom: ["@yourusername"]  // or your numeric user ID
    }
  }
}
```

5. Restart the gateway: `clank gateway restart`

### Telegram Commands

| Command | Action |
|---------|--------|
| `/help` | Show all commands |
| `/new` | Start a new session |
| `/reset` | Clear current session |
| `/compact` | Save state, clear context, continue |
| `/status` | Agent, model, tasks, uptime |
| `/agents` | List available agents |
| `/agent <name>` | Switch to a different agent |
| `/model` | Show current model + fallbacks |
| `/tasks` | Show background tasks with IDs |
| `/kill <id>` | Kill a specific background task |
| `/killall` | Kill all running tasks |
| `/think` | Toggle thinking display |
| `/version` | Show Clank version |

Commands are registered with Telegram's bot menu — they appear when you type `/`.

---

## Connect Discord

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create New Application → Bot → Copy Token
3. Enable **MESSAGE CONTENT** intent under Bot → Privileged Gateway Intents
4. Invite the bot to your server using the OAuth2 URL generator (needs Send Messages + Read Message History)
5. Edit `config.json5`:

```json5
{
  channels: {
    discord: {
      enabled: true,
      botToken: "YOUR_DISCORD_TOKEN"
    }
  }
}
```

---

## Cloud Providers

Add cloud providers as fallbacks or primary models. You can configure multiple during setup, or add them later.

### API Key Providers

```json5
{
  models: {
    providers: {
      anthropic: { apiKey: "sk-ant-..." },
      openai: { apiKey: "sk-..." },
      google: { apiKey: "AI..." },
      openrouter: { apiKey: "sk-or-...", baseUrl: "https://openrouter.ai/api/v1" },
      opencode: { apiKey: "...", baseUrl: "https://opencode.ai/zen" }
    }
  }
}
```

### OpenAI Codex (OAuth — ChatGPT Plus/Pro)

Use your existing ChatGPT subscription instead of paying API costs:

```bash
clank auth login
```

This opens your browser for OpenAI login. After authenticating, the token is stored securely and auto-refreshes. Use models like `codex/codex-mini-latest`.

```bash
clank auth status   # Check stored credentials
clank auth logout   # Remove credentials
```

### Model Format

Models use the format `provider/model`:

| Example | Provider |
|---------|----------|
| `ollama/qwen3.5` | Local Ollama |
| `anthropic/claude-sonnet-4-6` | Anthropic API |
| `openai/gpt-4o` | OpenAI API |
| `codex/codex-mini-latest` | OpenAI Codex (OAuth) |
| `google/gemini-2.0-flash` | Google Gemini |
| `openrouter/meta-llama/llama-3.1-70b` | OpenRouter |
| `opencode/claude-sonnet-4-6` | OpenCode |
| `llamacpp/model-name` | llama.cpp server |
| `lmstudio/model-name` | LM Studio |

### Fallback Chain

Set a primary model with cloud fallbacks:

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "ollama/qwen3.5",
        fallbacks: ["anthropic/claude-sonnet-4-6", "openai/gpt-4o"]
      }
    }
  }
}
```

If Ollama is down, Clank falls back to Anthropic, then OpenAI.

---

## Web Search (Brave)

1. Get a free API key at [brave.com/search/api](https://brave.com/search/api/)
2. Add to config:

```json5
{
  tools: {
    webSearch: {
      enabled: true,
      provider: "brave",
      apiKey: "BSA..."
    }
  }
}
```

---

## System Service

Auto-start the gateway at login:

```bash
clank daemon install
```

| Platform | Method |
|----------|--------|
| Windows | Task Scheduler (no admin needed) |
| macOS | LaunchAgent |
| Linux | systemd --user |

```bash
clank daemon status     # Check if running
clank daemon uninstall  # Remove
```

---

## Configuration

Config lives at:
- **Windows:** `%APPDATA%\Clank\config.json5`
- **macOS/Linux:** `~/.clank/config.json5`

JSON5 format (comments allowed, trailing commas OK). Supports `${ENV_VAR}` substitution:

```json5
{
  models: {
    providers: {
      anthropic: { apiKey: "${ANTHROPIC_API_KEY}" }
    }
  }
}
```

---

## Update

```bash
clank update
```

Or manually:

```bash
npm install -g @tractorscorch/clank
```

---

## Uninstall

Remove everything:

```bash
clank uninstall
```

Or manually:

```bash
rm -rf ~/.clank          # macOS/Linux
rd /s "%APPDATA%\Clank"  # Windows
npm uninstall -g @tractorscorch/clank
```

---

## Troubleshooting

### `clank fix`

Run diagnostics:

```bash
clank fix
```

Checks config, gateway, models, sessions, and workspace. Shows issues with suggested fixes.

### Common Issues

| Issue | Fix |
|-------|-----|
| "fetch failed" | Model server not running. Start Ollama: `ollama serve` |
| Port conflict | Change port in config.json5 |
| Telegram not responding | Check bot token, ensure only one instance polls the same token |
| Permission denied | Don't run as admin. Clank uses user-level paths. |
| Model refuses to use tools | Restart gateway — system prompt updates on restart |
| Telegram hangs on "typing" | Update to v1.7.2+ (typing indicator leak fixed). Restart gateway. |

---

## Next Steps

- Read the [User Guide](USER_GUIDE.md) for day-to-day usage
- Check the [Changelog](../CHANGELOG.md) for what's new
- Visit [clanksuite.dev](https://clanksuite.dev) for more info
