# Security Policy

## Supported Versions

| Version | Status |
|---------|--------|
| 1.7.x | Supported (current) |
| < 1.7.0 | Upgrade recommended |

Legacy versions have been deleted and are no longer available.

## Reporting a Vulnerability

If you discover a security vulnerability in Clank, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Contact the maintainer directly
3. Include: description, reproduction steps, potential impact

We will acknowledge receipt within 48 hours and provide a fix timeline within 7 days.

## Security Model

### Gateway
- Binds to `127.0.0.1` by default — not accessible from the network
- Token-based authentication for all WebSocket client connections
- Auto-generates auth token on startup if none configured
- `/status` endpoint requires Bearer token authentication
- `/health` endpoint is public (returns only version and uptime)
- Singleton enforcement — only one gateway instance per port

### Workspace Containment
- All file tools enforce path containment via `guardPath()`
- Absolute paths and `../` traversal outside the workspace are blocked
- External path access requires explicit `allowExternal` flag in tool context

### Tool Execution Safety
- **3-tier safety system** — tools classified as low/medium/high risk
- Configurable auto-approve per safety level (default: low=auto, medium/high=confirm)
- Gateway respects autoApprove config — 30 second timeout defaults to deny
- **Bash tool** — 25-pattern blocklist covering:
  - Recursive deletion (rm -rf, Remove-Item, del /s)
  - Disk formatting (format, mkfs, diskpart)
  - Force push to main/master branches
  - Shell-in-shell execution (pipe to bash, base64 decode)
  - System commands (shutdown, reboot, chmod 777)
  - PowerShell encoded commands
  - Registry modification

### Encryption
- API keys encrypted at rest with AES-256-GCM (PBKDF2, 100K iterations, SHA-256)
- PIN verification uses PBKDF2 hash with random salt, timing-safe comparison
- Optional encryption for conversation transcripts

### Config Security
- **Redaction** — API keys, bot tokens, and auth tokens are stripped before:
  - Sending to LLM context (config tool)
  - Sending to WebSocket clients (config.get RPC)
- **Prototype pollution protection** — `__proto__`, `constructor`, `prototype` keys blocked on config.set
- **Environment variables** — `${ENV_VAR}` substitution lets users avoid storing secrets in config files
- **.gitignore** — config.json5, *.pem, *.key, credentials.json excluded by default

### SSRF Protection
- `web_fetch` tool blocks:
  - localhost / 127.0.0.1 / [::1] / 0.0.0.0
  - Cloud metadata endpoints (169.254.169.254, metadata.google.internal)
  - Internal hostnames (.internal, .local)
  - file:// protocol

### Channels
- Per-channel user allowlists (Telegram supports both @username and numeric ID)
- Group chat mention requirements
- Optional DM pairing/approval flow

### Plugins
- In-process execution (trust boundary = user's machine)
- Local-only loading (no remote plugin fetching)
- Plugins respect agent-level tool policy restrictions

### Supply Chain Security
- **Pinned dependencies** — all versions in `package.json` use exact versions (no `^` or `~` ranges) to prevent auto-pulling compromised releases
- **Lockfile committed** — `package-lock.json` is committed and CI uses `npm ci` for reproducible installs
- **Minimal dependency tree** — 4 runtime dependencies (commander, grammy, json5, ws) to reduce attack surface
- **npm audit clean** as of v1.7.6
- **npm 2FA** — publishing requires two-factor authentication on the maintainer's npm account
- Consumers are encouraged to verify package integrity via `npm audit` after installation

## Known Limitations

- Bash blocklist is defense-in-depth, not exhaustive — the confirmation system is the primary safety mechanism
- Discord adapter does not have a user allowlist (planned for v2)
- Plugin system has no sandboxing — plugins have full process access
- Config file uses default OS permissions — may be world-readable on multi-user Linux systems
