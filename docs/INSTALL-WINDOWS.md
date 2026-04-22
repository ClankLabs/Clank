# Installing Clank on Windows

Step-by-step guide for Windows 10/11.

---

## Prerequisites

### 1. Install Node.js 20+

Download and install from [nodejs.org](https://nodejs.org/) (LTS recommended).

Verify in PowerShell or Command Prompt:

```powershell
node --version    # Should show v20.x or higher
npm --version
```

### 2. Install a Local Model Server (Recommended)

**Ollama** is the easiest way to run models locally:

1. Download from [ollama.com/download](https://ollama.com/download)
2. Run the installer
3. Pull a model:

```powershell
ollama pull qwen3.5
```

Clank also auto-detects **LM Studio** and **llama.cpp** if they're running.

> **Wrench** is recommended for the most polished local agent experience. Use [Wrench 9B](https://huggingface.co/ClankLabs/Wrench-9B-Q4_K_M-GGUF) for 8GB VRAM systems or [Wrench 35B](https://huggingface.co/ClankLabs/Wrench-35B-A3B-Q4_K_M-GGUF) for larger GPUs, then load via Ollama with a Modelfile or serve directly with llama.cpp.

---

## Install Clank

Open PowerShell and run:

```powershell
npm install -g @clanklabs/clank
```

Verify:

```powershell
clank --version
```

---

## Setup

Run the setup wizard:

```powershell
clank setup
```

The wizard will:
1. Detect any running local model servers
2. Let you pick a primary model
3. Optionally add cloud providers (Anthropic, OpenAI, Google, etc.)
4. Configure the gateway (port, auth token)
5. Create workspace files (SOUL.md, USER.md, etc.)
6. Optionally connect Telegram or Discord
7. Optionally set up web search (Brave) and voice (ElevenLabs)

For full control over every setting: `clank setup --advanced`

---

## Start Clank

```powershell
clank
```

This starts the gateway in the background and opens the TUI. Telegram and Discord bots connect automatically if configured.

### Other Interfaces

```powershell
clank chat              # Direct CLI chat (no gateway needed)
clank chat --web        # Start gateway + open Web UI in browser
clank tui               # Rich TUI connected to gateway
clank dashboard         # Open Web UI in browser
```

---

## Auto-Start at Login

```powershell
clank daemon install
```

This creates a Windows Task Scheduler entry (no admin required). The gateway starts automatically when you log in.

```powershell
clank daemon status      # Check if running
clank daemon uninstall   # Remove
```

---

## Configuration

Config file: `%APPDATA%\Clank\config.json5`

Open in your editor:

```powershell
notepad "$env:APPDATA\Clank\config.json5"
```

Or use VS Code:

```powershell
code "$env:APPDATA\Clank\config.json5"
```

The gateway watches this file and hot-reloads changes.

---

## Windows-Specific Notes

- **PowerShell is recommended** over Command Prompt for better Unicode and color support
- **Windows Defender** may briefly scan Clank on first run — this is normal
- **Node.js PATH** — the npm installer should add Node.js to your PATH automatically. If `clank` isn't found, restart your terminal.
- **Ollama** runs as a system service on Windows and starts automatically

---

## Update

```powershell
clank update
```

---

## Uninstall

```powershell
clank uninstall
```

Or manually:

```powershell
Remove-Item -Recurse "$env:APPDATA\Clank"
npm uninstall -g @clanklabs/clank
```

---

## Next Steps

- [User Guide](USER_GUIDE.md) — Day-to-day usage
- [Install Guide](INSTALL.md) — Channels, providers, web search, full config reference
