# Installing Clank on macOS

Step-by-step guide for macOS (Apple Silicon and Intel).

---

## Prerequisites

### 1. Install Node.js 20+

**Homebrew (recommended):**

```bash
brew install node
```

**Or download from** [nodejs.org](https://nodejs.org/) (LTS recommended).

Verify:

```bash
node --version    # Should show v20.x or higher
npm --version
```

### 2. Install a Local Model Server (Recommended)

**Ollama** is the easiest way to run models locally:

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3.5
```

Clank also auto-detects **LM Studio**, **llama.cpp**, and **vLLM** if they're running.

> **Wrench** is recommended for the most polished local agent experience. Use [Wrench 9B](https://huggingface.co/ClankLabs/Wrench-9B-Q4_K_M-GGUF) for 8GB VRAM systems or [Wrench 35B](https://huggingface.co/ClankLabs/Wrench-35B-A3B-Q4_K_M-GGUF) for larger GPUs, then load via Ollama with a Modelfile or serve directly with llama.cpp.

---

## Install Clank

### Option A: npm (recommended)

```bash
npm install -g @clanklabs/clank
```

### Option B: One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/ClankLabs/Clank/main/install.sh | bash
```

This checks for Node.js 20+, installs Clank via npm, and gets you ready to run `clank setup`.

Verify:

```bash
clank --version
```

---

## Setup

Run the setup wizard:

```bash
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

```bash
clank
```

This starts the gateway in the background and opens the TUI. Telegram and Discord bots connect automatically if configured.

### Other Interfaces

```bash
clank chat              # Direct CLI chat (no gateway needed)
clank chat --web        # Start gateway + open Web UI in browser
clank tui               # Rich TUI connected to gateway
clank dashboard         # Open Web UI in browser
```

---

## Auto-Start at Login

```bash
clank daemon install
```

This creates a LaunchAgent at `~/Library/LaunchAgents/dev.clanklabs.clank.plist`. The gateway starts automatically when you log in.

```bash
clank daemon status      # Check if running
clank daemon uninstall   # Remove
```

---

## Configuration

Config file: `~/.clank/config.json5`

```bash
open ~/.clank/config.json5        # Open in default editor
code ~/.clank/config.json5        # Open in VS Code
nano ~/.clank/config.json5        # Terminal editor
```

The gateway watches this file and hot-reloads changes.

---

## macOS-Specific Notes

- **Apple Silicon** — Ollama and llama.cpp both support Metal acceleration. Models run on the GPU automatically.
- **Gatekeeper** — if macOS blocks the standalone binary, run: `xattr -d com.apple.quarantine /usr/local/bin/clank`
- **Homebrew Node.js** — if you installed Node via Homebrew and `clank` isn't found after `npm install -g`, check that the npm global bin is in your PATH: `export PATH="$(npm config get prefix)/bin:$PATH"`

---

## Update

```bash
clank update
```

---

## Uninstall

```bash
clank uninstall
```

Or manually:

```bash
rm -rf ~/.clank
npm uninstall -g @clanklabs/clank
```

---

## Next Steps

- [User Guide](USER_GUIDE.md) — Day-to-day usage
- [Install Guide](INSTALL.md) — Channels, providers, web search, full config reference
