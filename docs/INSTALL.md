# Clank — Installation Guide

Complete guide to installing and setting up Clank.

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

Clank also auto-detects LM Studio, llama.cpp, and vLLM if they're running.

---

## Install Clank

```bash
npm install -g @tractorscorch/clank
```

Verify the installation:

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
3. **Cloud fallback** (optional) — add Anthropic, OpenAI, or Google as a backup
4. **Gateway settings** — port, auth token (auto-generated)
5. **Workspace** — creates SOUL.md, USER.md, IDENTITY.md, and other workspace files
6. **Channels** — connect Telegram bot, Discord bot (optional)
7. **Web search** — Brave Search API key (optional, free tier available)
8. **Daemon** — install as system service for auto-start at login

### Quick Start vs Advanced

- **Quick Start** (default) — sensible defaults, minimal questions, chatting in ~2 minutes
- **Advanced** (`clank setup --advanced`) — full control over gateway, models, channels, agents, voice

### Non-Interactive Setup

For scripting or CI:

```bash
clank setup \
  --non-interactive \
  --accept-risk \
  --model ollama/qwen3.5
```

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

When you run `clank`:
1. The gateway starts as a background process
2. Telegram/Discord bots connect and stay alive
3. The TUI opens for you to start chatting
4. You can open additional interfaces (Web UI, more terminals) simultaneously

All interfaces share the same sessions and memory.

---

## Connect Telegram

During setup, or afterward:

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token
4. Run `clank setup --section channels` or edit `config.json5`:

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
| `/help` | Show commands |
| `/status` | Agent and model info |
| `/agents` | List available agents |
| `/agent <name>` | Switch agent |
| `/new` | New session |
| `/reset` | Clear session |
| `/model` | Show current model |

---

## Connect Discord

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create New Application → Bot → Copy Token
3. Enable **MESSAGE CONTENT** intent under Bot → Privileged Gateway Intents
4. Invite the bot to your server using the OAuth2 URL generator
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

## Add Cloud Providers

Add cloud providers as fallbacks or primary models:

```bash
clank models add
```

Or edit `config.json5`:

```json5
{
  models: {
    providers: {
      anthropic: { apiKey: "sk-ant-..." },
      openai: { apiKey: "sk-..." },
      google: { apiKey: "AI..." }
    }
  },
  agents: {
    defaults: {
      model: {
        primary: "ollama/qwen3.5",
        fallbacks: ["anthropic/claude-sonnet-4-6"]
      }
    }
  }
}
```

---

## Add Web Search (Brave)

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

## Install as System Service

Auto-start the gateway at login:

```bash
clank daemon install
```

| Platform | Method |
|----------|--------|
| Windows | Task Scheduler (no admin needed) |
| macOS | LaunchAgent |
| Linux | systemd --user |

Check status: `clank daemon status`
Remove: `clank daemon uninstall`

---

## Configuration

Config lives at:
- **Windows:** `%APPDATA%\Clank\config.json5`
- **macOS/Linux:** `~/.clank/config.json5`

It's JSON5 (comments allowed, trailing commas OK). Edit it directly or use `clank setup --section <name>` to reconfigure specific sections.

Supports `${ENV_VAR}` substitution:

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

## Uninstall

Remove everything — config, data, sessions, memory, daemon, and the npm package:

```bash
clank uninstall
```

Or manually:

```bash
# Remove data
rm -rf ~/.clank          # macOS/Linux
rd /s "%APPDATA%\Clank"  # Windows

# Remove package
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
| Port conflict | Change port in config.json5 or use `--port` flag |
| Telegram not responding | Check bot token, ensure no other instance is polling the same token |
| Permission denied | Don't run as admin. Clank uses user-level paths. |

---

## Next Steps

- Read the [User Guide](USER_GUIDE.md) for day-to-day usage
- Check the [Changelog](../CHANGELOG.md) for what's new
- Visit [clanksuite.dev](https://clanksuite.dev) for more info
