# Clank — User Guide

How to use Clank day-to-day. For installation, see [INSTALL.md](INSTALL.md).

---

## The Basics

Clank is a gateway — one daemon runs in the background, and you connect from any interface:

```bash
clank
```

This starts the gateway and opens the TUI.

| Interface | Command | When to use |
|-----------|---------|-------------|
| **TUI** | `clank` or `clank tui` | Daily driver — rich terminal with streaming |
| **CLI** | `clank chat` | Quick direct chat, no gateway needed |
| **Web UI** | `clank dashboard` | Browser-based dashboard with all panels |
| **Telegram** | Message your bot | On the go, from your phone |
| **Discord** | Message in server | Team/community access |

All interfaces share sessions. Start a conversation in TUI, continue it from Telegram, check the results in the Web UI.

---

## Talking to Your Agent

Just type naturally:

```
you > Read the README and summarize the project structure
you > Fix the failing test in auth.test.ts
you > Search for all TODO comments in the codebase
you > Install express and create a basic server
```

The agent reads files, writes code, runs commands, and uses tools automatically.

### Tool Confirmations

Risky operations ask for confirmation in the TUI/Web UI:

```
  Confirm: Run: npm install express [y/n/always]
```

- `y` — approve this one
- `n` — deny
- `always` — auto-approve this tool for the rest of the session

**Telegram and Discord** auto-approve all tools (no interactive confirmation UI).

Configure in config:

```json5
{
  tools: {
    autoApprove: {
      low: true,     // read operations — auto-approved
      medium: false,  // write operations — ask
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
| `/help` | Show commands |
| `/status` | Agent, model, session info |
| `/agent [name]` | Switch or list agents |
| `/session [key]` | Switch or list sessions |
| `/model` | Show current model |
| `/think` | Toggle thinking block visibility |
| `/tools` | Toggle tool output display |
| `/compact` | Save state, clear context, continue where you left off |
| `/new` | Start a new session |
| `/reset` | Clear current session |
| `/exit` | Quit |

### Shell Commands

Prefix with `!` to run a command on your machine:

```
you > !git status
you > !npm test
you > !docker ps
```

---

## Telegram Commands

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
| `/model` | Show model + fallback chain |
| `/tasks` | Show background tasks with short IDs |
| `/kill <id>` | Kill a specific task (+ children) |
| `/killall` | Kill all running tasks |
| `/think` | Toggle thinking display per-chat |
| `/version` | Show Clank version |

### Telegram Features

- **Streaming** — responses stream in real-time via message editing
- **Tool indicators** — when the agent uses tools, you see emoji indicators above the response (📄 read_file, 💻 bash, 🔍 search, etc.)
- **Thinking display** — toggle with `/think` to see the model's reasoning process
- **Voice messages** — send a voice message and get a voice reply (requires Whisper STT + ElevenLabs TTS)
- **Photos** — send images for the agent to describe or analyze
- **Documents** — upload files for the agent to read and process (max 10MB)

---

## Web UI

Open with `clank dashboard` or `clank chat --web`.

### Panels

| Panel | What it does |
|-------|-------------|
| **Chat** | Send messages, see streaming responses, tool cards, collapsible thinking blocks |
| **Agents** | View configured agents, their models, and status |
| **Sessions** | Browse all sessions, switch between them |
| **Config** | Edit config.json5 directly in the browser |
| **Pipelines** | View pipeline definitions and execution history |
| **Cron** | View and manage scheduled jobs |
| **Logs** | Live log output with level coloring |
| **Channels** | Channel adapter status (Telegram, Discord, etc.) |

---

## Multi-Agent Setup

Create named agents with different models, workspaces, and tools:

```json5
{
  agents: {
    defaults: {
      model: { primary: "ollama/qwen3.5" },
      subagents: {
        maxConcurrent: 8,   // max simultaneous background tasks
        maxSpawnDepth: 1     // 0 = main only, 1 = one level of sub-agents
      }
    },
    list: [
      {
        id: "coder",
        name: "Coder",
        model: { primary: "ollama/qwen3.5" },
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
- **Web UI:** Agents panel

### Per-Agent Model Assignment

Each agent can use any configured provider:

```json5
{
  id: "fast-coder",
  model: { primary: "ollama/qwen3.5" }       // Local, fast
},
{
  id: "deep-thinker",
  model: { primary: "anthropic/claude-sonnet-4-6" }  // Cloud, capable
},
{
  id: "budget",
  model: { primary: "openrouter/meta-llama/llama-3.1-70b" }  // OpenRouter
}
```

---

## Background Tasks (Sub-Agents)

The main agent can spawn tasks on sub-agents that run independently in the background.

### How It Works

1. You ask the main agent to do something in the background
2. The agent uses `spawn_task` to create a sub-agent
3. The sub-agent runs its task independently
4. You continue chatting with the main agent
5. When the sub-agent finishes, results are delivered to the main agent on your next message

### Example

```
you > Research the latest Node.js security best practices
      in the background using the researcher agent

agent > Task spawned successfully.
        Task ID: a3f2b1c9
        Agent: researcher
        The task is running in the background. Results will
        be delivered when it completes.

you > While that's running, help me refactor this function...

agent > [Background task completed results appear here on next message]
```

### Task Control

The main agent can control running tasks:

| Action | What it does |
|--------|-------------|
| **spawn** | Start a new background task |
| **kill** | Cancel a running task (cascades to children) |
| **steer** | Kill and re-spawn with new instructions |
| **message** | Send a message to a running child |
| **status** | Check a specific task |
| **list** | See all tasks |

### Telegram Task Management

```
/tasks     — See all tasks with short IDs
/kill abc1 — Kill task by short ID
/killall   — Kill all running tasks
```

### Depth Control

Sub-agents can optionally spawn their own sub-agents (orchestrator pattern):

```json5
{
  agents: {
    defaults: {
      subagents: {
        maxSpawnDepth: 2,    // Allow orchestrator → worker
        maxConcurrent: 8     // Max 8 simultaneous tasks
      }
    }
  }
}
```

- **Depth 0** = main agent (can always spawn)
- **Depth 1** = first-level sub-agent (can spawn if maxSpawnDepth > 1)
- **Depth N** = leaf agent (cannot spawn further)

### GPU Contention

When a background task runs on the same local model as the main agent, they share the GPU. Local models queue requests, so both will work but slower. For best results, use a cloud provider for sub-agents when your main agent is local.

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
| `IDENTITY.md` | The agent's name, vibe, emoji |
| `MEMORY.md` | Persistent notes and learnings |
| `AGENTS.md` | Agent definitions |
| `TOOLS.md` | Tool access configuration |
| `BOOTSTRAP.md` | First-conversation script (auto-deleted) |
| `HEARTBEAT.md` | Periodic check definitions |
| `RUNNER.md` | Sub-agent playbook (auto-injected for spawned tasks) |

Edit these files to customize behavior. The agent can also edit them through conversation.

### Project Memory

Put a `.clank.md` in any project root — the agent reads it automatically for project-specific context.

### Agent Memory

- TF-IDF matched, decays over time
- Categorized: identity, knowledge, lessons, context
- Auto-persists: "remember X" commands, corrections, preferences

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
    bind: "loopback",       // "loopback" or "lan"
    auth: { mode: "token" } // token auto-generated
  },

  // Agents
  agents: {
    defaults: {
      model: {
        primary: "ollama/qwen3.5",
        fallbacks: ["anthropic/claude-sonnet-4-6"]
      },
      toolTier: "auto",
      temperature: 0.7,
      subagents: {
        maxConcurrent: 8,
        maxSpawnDepth: 1
      }
    },
    list: [
      // Custom agents go here
    ]
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
    discord: { enabled: false, botToken: "..." }
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
| `clank models list` | List available models |
| `clank agents list` | List configured agents |
| `clank daemon install\|uninstall\|status` | System service |
| `clank tui` | Open TUI |
| `clank dashboard` | Open Web UI |
| `clank cron list\|add\|remove` | Manage cron jobs |
| `clank auth login\|status\|logout` | Manage OAuth credentials |
| `clank update` | Update to latest version |
| `clank uninstall` | Remove everything |

---

## Tips

- **Workspace = cwd** — the agent works in whatever directory you launch `clank` from
- **Full system access** — the agent can read/write anywhere. Run on dedicated hardware.
- **Project context** — put a `.clank.md` in any project root for per-project context
- **Tool tiering** — `"core"` for smaller models, `"auto"` for middle ground, `"full"` for capable models
- **Multiple terminals** — open as many TUI/CLI sessions as you want, all share the same gateway
- **Self-config** — tell your agent: *"Add Brave search"*, *"Connect Telegram"*, *"Create a cron job"*

---

## Links

- **Website:** [clanklabs.dev](https://clanklabs.dev)
- **GitHub:** [ItsTrag1c/Clank](https://github.com/ItsTrag1c/Clank)
- **Twitter/X:** [@Clank_Labs](https://x.com/Clank_Labs)
- **Reddit:** [u/ClankLabs](https://reddit.com/u/ClankLabs)
