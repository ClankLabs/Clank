# User Guide

How to use Clank day-to-day. For installation, see the [Install Guide](INSTALL.md).

> **Security Notice:** Clank gives AI agents full access to your file system, shell, and connected services. **We strongly recommend running Clank on dedicated hardware** (dev machine, VM, or container) rather than on systems with sensitive personal data.

---

## The Basics

Clank is a gateway — one daemon runs in the background, and you connect from any interface:

```bash
clank
```

This starts the gateway and opens the TUI.

| Interface | Command | Best for |
|-----------|---------|----------|
| **TUI** | `clank` or `clank tui` | Daily driver — rich terminal with streaming |
| **CLI** | `clank chat` | Quick one-off chat, no gateway needed |
| **Web UI** | `clank dashboard` | Browser dashboard with all panels |
| **Telegram** | Message your bot | On the go, from your phone |
| **Discord** | Message in server | Team or community access |
| **Signal** | Message your number | Private, encrypted channel |

All interfaces share sessions. Start a conversation in TUI, continue it from Telegram, check results in the Web UI.

---

## Talking to Your Agent

Type naturally:

```
you > Read the README and summarize the project structure
you > Fix the failing test in auth.test.ts
you > Search for all TODO comments in the codebase
you > What's the weather like today?
```

The agent reads files, writes code, runs commands, searches the web, and uses tools automatically.

### Tool Confirmations

When the agent wants to run a risky operation, it asks for confirmation.

**TUI / CLI:**
```
  Confirm: Run: npm install express [y/n/always]
```
- `y` — approve this one
- `n` — deny
- `always` — auto-approve this tool for the session

**Telegram:** Inline keyboard with **Approve** / **Always** / **Deny** buttons. Shows the tool name and what it's doing. Auto-approves after 30 seconds if you don't respond.

**Discord:** Button components with the same **Approve** / **Always** / **Deny** flow.

**Signal:** Auto-approves all tools (no interactive button API).

Configure default behavior in config:

```json5
{
  tools: {
    autoApprove: {
      low: true,     // read operations — auto-approved
      medium: false,  // write operations — ask first
      high: false     // bash, system ops — always ask
    }
  }
}
```

---

## TUI Commands

### Slash Commands

| Command | Action |
|---------|--------|
| `/help` | Show available commands |
| `/status` | Agent, model, session info |
| `/agent [name]` | Switch or list agents |
| `/session [key]` | Switch or list sessions |
| `/model` | Show current model, provider, tool mode, context, and fallbacks |
| `/think` | Toggle thinking block visibility |
| `/tools` | Toggle tool output display |
| `/compact` | Save state, clear context, continue where you left off |
| `/new` | Start a new session |
| `/reset` | Clear current session |
| `/exit` | Quit |

### Shell Commands

Prefix with `!` to run a command on your machine without going through the agent:

```
you > !git status
you > !npm test
you > !docker ps
```

---

## Telegram

Commands are registered in Telegram's bot menu — they appear when you type `/`.

| Command | Action |
|---------|--------|
| `/help` | Show all commands |
| `/new` | Start a fresh session |
| `/reset` | Clear current session history |
| `/compact` | Save state, clear context, continue |
| `/status` | Model, agents, tasks, uptime |
| `/agents` | List agents with their models |
| `/agent <name>` | Switch to a different agent |
| `/model` | Show model, provider, tool mode, context, and fallback chain |
| `/models` | List available models and switch with `/models set <provider/model>` |
| `/tasks` | Show background tasks with short IDs |
| `/kill <id>` | Kill a specific task (cascades to children) |
| `/killall` | Kill all running tasks |
| `/think` | Toggle thinking display per-chat |
| `/version` | Show Clank version |

### Telegram Features

- **Streaming** — responses stream in real-time via message editing
- **Tool indicators** — emoji indicators above the response (📄 read_file, 💻 bash, 🔍 search, 🌐 web_fetch, etc.)
- **Inline tool approvals** — Approve / Always / Deny buttons when the agent needs confirmation
- **Thinking display** — toggle with `/think` to see the model's reasoning
- **Voice messages** — send a voice message and get a voice reply (requires Whisper STT + ElevenLabs TTS)
- **Photos** — send images for the agent to describe or analyze
- **Documents** — upload files for the agent to read and process (max 10MB)

---

## Discord

- **Streaming** — responses stream in real-time
- **Slash commands** — same as Telegram (`/help`, `/new`, `/status`, etc.)
- **Inline tool approvals** — Approve / Always / Deny buttons for tool confirmations
- **Thread support** — conversations in threads map to separate sessions

---

## Signal

- **DM and group support** — phone number allowlist controls who can message
- **Slash commands** — `/help`, `/new`, `/status`, `/agents`, etc.
- **Tool indicators** — emoji indicators for active tools
- **Auto-approve** — tools run automatically (Signal has no interactive button API)

---

## Web UI

Open with `clank dashboard` or `clank chat --web`.

| Panel | What it does |
|-------|-------------|
| **Chat** | Send messages, see streaming responses, tool cards, collapsible thinking blocks |
| **Agents** | View configured agents, their models, and status |
| **Sessions** | Browse all sessions, switch between them |
| **Config** | Edit config.json5 directly in the browser |
| **Pipelines** | View pipeline definitions and execution history |
| **Cron** | View and manage scheduled jobs |
| **Logs** | Live log output with level coloring |
| **Channels** | Channel adapter status (Telegram, Discord, Signal, Web) |

---

## Multi-Agent Setup

Create named agents with different models, workspaces, and tools:

```json5
{
  agents: {
    defaults: {
      model: { primary: "ollama/wrench" },
      subagents: {
        maxConcurrent: 8,
        maxSpawnDepth: 1
      }
    },
    list: [
      {
        id: "coder",
        name: "Coder",
        model: { primary: "ollama/wrench" },
        workspace: "~/Projects"
      },
      {
        id: "researcher",
        name: "Researcher",
        model: { primary: "anthropic/claude-sonnet-4-6" },
        tools: { allow: ["web_search", "web_fetch", "read_file"] }
      },
      {
        id: "writer",
        name: "Writer",
        model: { primary: "openrouter/anthropic/claude-sonnet-4-6" },
        toolTier: "core"
      }
    ]
  }
}
```

Or tell your agent: *"Create a new agent called Researcher that uses Claude for web research"*

### Switching Agents

- **TUI:** `/agent researcher`
- **Telegram:** `/agent researcher`
- **Discord:** `/agent researcher`
- **Signal:** `/agent researcher`
- **Web UI:** Agents panel

---

## Background Tasks (Sub-Agents)

The main agent can spawn tasks on sub-agents that run independently.

### How It Works

1. Ask the main agent to do something in the background
2. The agent uses `spawn_task` to create a sub-agent
3. The sub-agent runs independently while you keep chatting
4. Results are delivered to the main agent on your next message

### Example

```
you > Research the latest Node.js security best practices
      in the background using the researcher agent

agent > Task spawned: a3f2b1c9 (researcher)
        Running in the background.

you > While that's running, help me refactor this function...
```

### Task Control

| Action | What it does |
|--------|-------------|
| **spawn** | Start a new background task |
| **kill** | Cancel a running task (cascades to children) |
| **steer** | Kill and re-spawn with new instructions |
| **message** | Send a message to a running child |

**Telegram/Discord task management:**
```
/tasks     — See all tasks with short IDs
/kill abc1 — Kill task by short ID
/killall   — Kill all running tasks
```

### Depth Control

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxSpawnDepth: 2,    // Allow orchestrator > worker pattern
        maxConcurrent: 8     // Max 8 simultaneous tasks
      }
    }
  }
}
```

---

## Scheduled Tasks (Cron)

Create recurring tasks:

```bash
clank cron add --name "Daily summary" --schedule "24h" --prompt "Summarize what changed today"
```

Or tell your agent: *"Check for updates every hour and notify me on Telegram"*

```bash
clank cron list
clank cron remove <id>
```

---

## Memory

Clank remembers across sessions through several mechanisms:

### Workspace Files

| File | Purpose |
|------|---------|
| `SOUL.md` | Agent personality and behavior rules |
| `USER.md` | Information about you |
| `IDENTITY.md` | Agent name, vibe, emoji |
| `MEMORY.md` | Persistent notes and learnings |
| `AGENTS.md` | Agent definitions |
| `TOOLS.md` | Tool access configuration |
| `BOOTSTRAP.md` | First-conversation script (auto-deleted after use) |
| `HEARTBEAT.md` | Periodic check definitions |
| `RUNNER.md` | Sub-agent playbook (auto-injected for spawned tasks) |

Edit these files to customize behavior. The agent can also edit them through conversation.

### Project Memory

Put a `.clank.md` in any project root — the agent reads it automatically for project-specific context.

### Agent Memory

- **TF-IDF matched** — memories are scored by relevance to the current conversation
- **Decay scoring** — older memories lose weight over time
- **Auto-persistence** — "remember X" commands, corrections, and preferences are saved automatically
- **Smart injection for local models** — only relevant memories are injected into context (saves tokens)

---

## Plugins

Extend Clank with local plugins:

```bash
npm install clank-plugin-docker

# Or put it in the plugins directory
~/.clank/plugins/my-plugin/
```

Plugin manifest (`clank-plugin.json`):

```json
{
  "name": "clank-plugin-docker",
  "version": "1.0.0",
  "type": "tool",
  "tools": [{
    "name": "docker_exec",
    "description": "Run a command in a Docker container",
    "safetyLevel": "high",
    "entrypoint": "./tools/docker-exec.js"
  }]
}
```

---

## Configuration Reference

Config file: `~/.clank/config.json5` (or `%APPDATA%\Clank\config.json5` on Windows)

```json5
{
  // Gateway
  gateway: {
    port: 18790,
    bind: "loopback",
    auth: { mode: "token" }
  },

  // Agents
  agents: {
    defaults: {
      model: {
        primary: "ollama/wrench",
        fallbacks: ["anthropic/claude-sonnet-4-6"]
      },
      toolTier: "auto",
      temperature: 0.7,
      subagents: { maxConcurrent: 8, maxSpawnDepth: 1 }
    },
    list: []
  },

  // Providers
  models: {
    providers: {
      ollama: { baseUrl: "http://127.0.0.1:11434" },
      anthropic: { apiKey: "..." },
      openai: { apiKey: "..." },
      google: { apiKey: "..." },
      openrouter: { apiKey: "...", baseUrl: "https://openrouter.ai/api/v1" },
      opencode: { apiKey: "...", baseUrl: "https://opencode.ai/zen" }
    }
  },

  // Channels
  channels: {
    web: { enabled: true },
    telegram: { enabled: true, botToken: "...", allowFrom: ["@you"] },
    discord: { enabled: false, botToken: "..." },
    signal: { enabled: false, socketPath: "/tmp/signal-cli.sock", account: "+1...", allowFrom: ["+1..."] }
  },

  // Sessions
  session: { dmScope: "main", maxSessions: 50 },

  // Tools
  tools: {
    autoApprove: { low: true, medium: false, high: false },
    webSearch: { enabled: true, provider: "brave", apiKey: "..." }
  },

  // Integrations
  integrations: {
    elevenlabs: { enabled: true, apiKey: "...", voiceId: "..." },
    whisper: { enabled: true, provider: "groq", apiKey: "..." }
  }
}
```

Supports `${ENV_VAR}` substitution for secrets.

---

## CLI Reference

| Command | Description |
|---------|-------------|
| `clank` | Start gateway + TUI |
| `clank chat` | Direct CLI chat |
| `clank chat --web` | Open Web UI |
| `clank gateway start\|stop\|restart\|status` | Manage gateway |
| `clank setup` | Run setup wizard |
| `clank setup --advanced` | Full control setup |
| `clank fix` | Run diagnostics |
| `clank models list\|add\|test` | Model management |
| `clank agents list\|add` | Agent management |
| `clank daemon install\|uninstall\|status` | System service |
| `clank tui` | Open TUI |
| `clank dashboard` | Open Web UI |
| `clank cron list\|add\|remove` | Manage cron jobs |
| `clank auth login\|status\|logout` | Manage OAuth credentials |
| `clank channels` | Channel adapter status |
| `clank update` | Update to latest version |
| `clank uninstall` | Remove everything |

---

## Tips

- **Workspace = cwd** — the agent works in whatever directory you launch `clank` from
- **Full system access** — the agent can read/write anywhere. Run on dedicated hardware.
- **Project context** — put a `.clank.md` in any project root for per-project instructions
- **Tool tiering** — `"core"` for smaller models, `"auto"` for middle ground, `"full"` for capable models
- **Multiple terminals** — open as many TUI/CLI sessions as you want, all share the same gateway
- **Self-config** — tell your agent: *"Add Brave search"*, *"Connect Telegram"*, *"Create a cron job"*
- **Web search** — the agent uses `web_search` and `web_fetch` automatically when it needs current information

---

## Links

- **Website:** [clanklabs.dev](https://clanklabs.dev)
- **GitHub:** [ClankLabs/Clank](https://github.com/ClankLabs/Clank)
- **Twitter/X:** [@Clank_Labs](https://x.com/Clank_Labs)
- **Reddit:** [u/ClankLabs](https://reddit.com/u/ClankLabs)
