# Installing Clank on Linux

Step-by-step guide for Ubuntu, Debian, Fedora, Arch, and other distributions.

---

## Prerequisites

### 1. Install Node.js 20+

**Ubuntu / Debian:**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Fedora:**

```bash
sudo dnf install nodejs
```

**Arch:**

```bash
sudo pacman -S nodejs npm
```

**Or use nvm** (any distro):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
```

Verify:

```bash
node --version    # Should show v20.x or higher
npm --version
```

### 2. Install a Local Model Server (Recommended)

**Ollama:**

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama pull qwen3.5
```

Clank also auto-detects **LM Studio**, **llama.cpp**, and **vLLM** if they're running.

> **Wrench** is recommended for the most polished local agent experience. Use [Wrench 9B](https://huggingface.co/ClankLabs/Wrench-9B-Q4_K_M-GGUF) for 8GB VRAM systems or [Wrench 35B](https://huggingface.co/ClankLabs/Wrench-35B-A3B-Q4_K_M-GGUF) for larger GPUs, then load via Ollama with a Modelfile or serve directly with llama.cpp.

---

## Install Clank

### Option A: npm

```bash
npm install -g @clanklabs/clank
```

### Option B: One-liner

```bash
curl -fsSL https://raw.githubusercontent.com/ClankLabs/Clank/main/install.sh | bash
```

This checks for Node.js 20+, installs Clank via npm, and mentions Signal setup on Linux.

> **Note:** If you get `EACCES` permission errors, configure npm to use a local prefix instead of running with `sudo`:
> ```bash
> mkdir -p ~/.npm-global
> npm config set prefix '~/.npm-global'
> echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
> source ~/.bashrc
> ```
> Then retry `npm install -g @clanklabs/clank`.

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
6. Optionally connect Telegram, Discord, or Signal
7. Optionally set up web search (Brave) and voice (ElevenLabs)

For full control over every setting: `clank setup --advanced`

---

## Start Clank

```bash
clank
```

This starts the gateway in the background and opens the TUI. Telegram, Discord, and Signal bots connect automatically if configured.

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

This creates a systemd user service at `~/.config/systemd/user/clank.service`. The gateway starts automatically when you log in.

```bash
clank daemon status      # Check if running
clank daemon uninstall   # Remove
```

> **Note:** systemd user services require `loginctl enable-linger $USER` to persist across sessions on headless servers.

---

## Configuration

Config file: `~/.clank/config.json5`

```bash
nano ~/.clank/config.json5         # Terminal editor
code ~/.clank/config.json5         # VS Code
vim ~/.clank/config.json5          # Vim
```

The gateway watches this file and hot-reloads changes.

---

## Linux-Specific Notes

- **NVIDIA GPUs** — ensure CUDA drivers are installed for GPU-accelerated inference with Ollama or llama.cpp. Check with `nvidia-smi`.
- **AMD GPUs** — Ollama supports ROCm on supported AMD cards. See [Ollama docs](https://ollama.com/blog/amd-preview) for setup.
- **Headless servers** — Clank works great on headless boxes. Use `clank gateway start` to run the daemon, then connect from Telegram, Discord, Signal, or the Web UI.
- **Docker** — Clank can run in a container. Mount a volume for `~/.clank/` to persist config and sessions.
- **File permissions** — config.json5 uses default OS permissions. On multi-user systems, consider `chmod 600 ~/.clank/config.json5` to restrict access.
- **Signal** — Linux is the only platform that supports Signal integration (signal-cli is Linux-only). Run `clank setup --signal` for guided install, registration, and automatic daemon management.

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
