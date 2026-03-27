# Installation Guide

Complete guide to installing and setting up Clank on any platform.

> **Security Notice:** Clank is a developer tool that gives AI agents full access to your file system, shell, and connected services. We strongly recommend running it on dedicated hardware (dev machine, VM, or container) rather than on systems with sensitive personal data.

---

## Platform Guides

| Platform | Guide |
|----------|-------|
| **Windows** | [INSTALL-WINDOWS.md](INSTALL-WINDOWS.md) |
| **macOS** | [INSTALL-MACOS.md](INSTALL-MACOS.md) |
| **Linux** | [INSTALL-LINUX.md](INSTALL-LINUX.md) |

Each guide covers prerequisites, installation, setup, and platform-specific configuration.

---

## Quick Install (All Platforms)

If you already have Node.js 20+ installed:

```bash
npm install -g @clanklabs/clank
clank setup
clank
```

---

## What Setup Does

The `clank setup` wizard handles everything:

1. **Detects local models** — scans for Ollama, LM Studio, llama.cpp, vLLM on standard ports
2. **Configures your primary model** — picks the best available model as default
3. **Cloud providers** (optional) — add any combination of:
   - Anthropic (Claude)
   - OpenAI (GPT-4o, Codex)
   - Google (Gemini)
   - OpenRouter (many models via one key)
   - OpenCode (subscription-based)
   - Codex OAuth (use your ChatGPT Plus/Pro subscription)
4. **Gateway settings** — port (default 18790), auth token (auto-generated)
5. **Workspace** — creates SOUL.md, USER.md, IDENTITY.md, and other agent workspace files
6. **Channels** (optional) — connect Telegram bot, Discord bot, Signal
7. **Web search** (optional) — Brave Search API key (free tier available)
8. **Voice** (optional) — ElevenLabs TTS, Whisper STT
9. **Daemon** — install as system service for auto-start at login

### Quick vs Advanced

| Mode | Command | What it does |
|------|---------|-------------|
| **Quick** | `clank setup` | Sensible defaults, minimal questions, chatting in ~2 minutes |
| **Advanced** | `clank setup --advanced` | Full control over gateway, models, channels, agents, voice |

### Re-running Setup

Setup preserves your existing config. API keys and settings you've already configured are shown and can be kept by pressing Enter.

---

## Connecting Channels

### Telegram

1. Message [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow the prompts
3. Copy the bot token
4. Run `clank setup` or add to config:

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

### Discord

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. Create New Application > Bot > Copy Token
3. Enable **MESSAGE CONTENT** intent under Bot > Privileged Gateway Intents
4. Invite the bot using the OAuth2 URL generator (needs Send Messages + Read Message History)
5. Add to config:

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

### Signal (Linux Only)

Signal integration requires [signal-cli](https://github.com/AsamK/signal-cli), which only runs on Linux. If you run Clank on a Linux server or VM, Signal works great as a mobile interface.

The easiest way to set up Signal is the dedicated wizard:

```bash
clank setup --signal
```

This walks you through:
1. Checking prerequisites (Java, signal-cli)
2. Phone number registration and SMS/voice verification
3. Configuring the daemon endpoint and allowlist
4. Starting the daemon

**Clank manages the signal-cli daemon automatically** — it starts with the gateway and stops when the gateway shuts down. No manual daemon management needed.

#### Manual Setup

If you prefer to configure manually:

1. Install [signal-cli](https://github.com/AsamK/signal-cli) and register your phone number
2. Add to config:

```json5
{
  channels: {
    signal: {
      enabled: true,
      endpoint: "http://localhost:7583",
      account: "+1234567890",
      allowFrom: ["+1987654321"]
    }
  }
}
```

Clank will auto-start signal-cli as a daemon when the gateway launches.

---

## Cloud Providers

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

### Codex OAuth (ChatGPT Plus/Pro)

Use your existing ChatGPT subscription instead of paying API costs:

```bash
clank auth login     # Opens browser for OpenAI login
clank auth status    # Check stored credentials
clank auth logout    # Remove credentials
```

### Model Format

Models use the format `provider/model`:

| Example | Provider |
|---------|----------|
| `ollama/qwen3.5` | Local Ollama |
| `ollama/wrench` | Wrench via Ollama |
| `anthropic/claude-sonnet-4-6` | Anthropic API |
| `openai/gpt-4o` | OpenAI API |
| `codex/codex-mini-latest` | Codex (OAuth) |
| `google/gemini-2.0-flash` | Google Gemini |
| `openrouter/meta-llama/llama-3.1-70b` | OpenRouter |
| `llamacpp/model-name` | llama.cpp server |
| `lmstudio/model-name` | LM Studio |

### Fallback Chains

Set a primary model with automatic fallbacks:

```json5
{
  agents: {
    defaults: {
      model: {
        primary: "ollama/wrench",
        fallbacks: ["anthropic/claude-sonnet-4-6", "openai/gpt-4o"]
      }
    }
  }
}
```

If Ollama is down, Clank falls back to Anthropic, then OpenAI.

---

## Web Search

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

The agent will use `web_search` and `web_fetch` automatically when it needs current information.

---

## System Service (Daemon)

Auto-start the gateway at login:

```bash
clank daemon install
```

| Platform | Method |
|----------|--------|
| **Windows** | Task Scheduler (no admin needed) |
| **macOS** | LaunchAgent (`~/Library/LaunchAgents/`) |
| **Linux** | systemd user service (`~/.config/systemd/user/`) |

```bash
clank daemon status      # Check if running
clank daemon uninstall   # Remove
```

---

## Configuration

Config file location:
- **Windows:** `%APPDATA%\Clank\config.json5`
- **macOS / Linux:** `~/.clank/config.json5`

JSON5 format — comments allowed, trailing commas OK, unquoted keys. Supports `${ENV_VAR}` substitution:

```json5
{
  models: {
    providers: {
      anthropic: { apiKey: "${ANTHROPIC_API_KEY}" }
    }
  }
}
```

The gateway watches the config file and hot-reloads changes without restart.

---

## Update

```bash
clank update
```

Or manually: `npm install -g @clanklabs/clank`

---

## Uninstall

```bash
clank uninstall
```

This removes all data, the system service, and the npm package. Or manually:

```bash
# macOS / Linux
rm -rf ~/.clank
npm uninstall -g @clanklabs/clank

# Windows (PowerShell)
Remove-Item -Recurse "$env:APPDATA\Clank"
npm uninstall -g @clanklabs/clank
```

---

## Troubleshooting

Run diagnostics:

```bash
clank fix
```

Checks config, gateway, models, sessions, and workspace. Shows issues with suggested fixes.

### Common Issues

| Issue | Fix |
|-------|-----|
| `fetch failed` | Model server not running. Start Ollama: `ollama serve` |
| Port conflict on 18790 | Change port in config.json5: `gateway: { port: 18791 }` |
| Telegram not responding | Check bot token. Ensure only one instance polls the same token. |
| Model refuses to use tools | Restart gateway — system prompt updates on restart |
| Permission denied | Don't run as admin/root. Clank uses user-level paths. |
| Web search returns errors | Check Brave API key in config. Free tier has rate limits. |

---

## Next Steps

- Read the [User Guide](USER_GUIDE.md) for day-to-day usage
- Check the [Changelog](../CHANGELOG.md) for what's new
- Visit [clanklabs.dev](https://clanklabs.dev) for more info
