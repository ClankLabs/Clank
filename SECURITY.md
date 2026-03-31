# Security Policy

## Supported Versions

| Version | Status |
|---------|--------|
| 1.11.x | **Current** — actively maintained |
| 1.10.x | Security fixes only |
| < 1.10.0 | Unsupported — upgrade recommended |

## Reporting a Vulnerability

If you discover a security vulnerability in Clank, please report it responsibly:

1. **Do not** open a public GitHub issue for sensitive vulnerabilities
2. Open a [GitHub Issue](https://github.com/ClankLabs/Clank/issues) with the `security` label, or reach out to [@Clank_Labs](https://x.com/Clank_Labs) for sensitive disclosures
3. Include: description, reproduction steps, potential impact

We will acknowledge receipt within 48 hours and provide a fix timeline within 7 days.

---

## Security Model

### Gateway

- Binds to `127.0.0.1` by default — not accessible from the network
- Token-based authentication for all WebSocket connections
- Auth token auto-generated on first startup
- `/status` endpoint requires Bearer token authentication
- `/health` endpoint is public (returns only version and uptime)
- Singleton enforcement — only one gateway instance per port

### Workspace Containment

- All file tools enforce path containment via `guardPath()`
- Absolute paths and `../` traversal outside the workspace are blocked
- External path access requires explicit `allowExternal` flag in tool context

### Tool Execution Safety

- **3-tier safety system** — tools classified as low / medium / high risk
- Configurable auto-approve per safety level (default: low=auto, medium/high=confirm)
- **Inline tool approvals** — Telegram shows InlineKeyboard, Discord shows Button components with Approve / Always / Deny options. 30-second timeout defaults to approve.
- **Bash blocklist** — 25 patterns covering:
  - Recursive deletion (`rm -rf`, `Remove-Item`, `del /s`)
  - Disk formatting (`format`, `mkfs`, `diskpart`)
  - Force push to main/master branches
  - Shell-in-shell execution (pipe to bash, base64 decode)
  - System commands (`shutdown`, `reboot`, `chmod 777`)
  - PowerShell encoded commands
  - Registry modification
  - Fork bombs

### Encryption

- API keys encrypted at rest with AES-256-GCM (PBKDF2, 100K iterations, SHA-256)
- PIN verification uses PBKDF2 hash with random salt, timing-safe comparison
- Optional encryption for conversation transcripts

### Config Security

- **Redaction** — API keys, bot tokens, and auth tokens are stripped before:
  - Sending to LLM context (config tool)
  - Sending to WebSocket clients (config.get RPC)
- **Prototype pollution protection** — `__proto__`, `constructor`, `prototype` keys blocked on config.set and all RPC input
- **Environment variables** — `${ENV_VAR}` substitution lets users avoid storing secrets in config files
- **.gitignore** — config.json5, *.pem, *.key, credentials.json excluded by default

### SSRF Protection

`web_fetch` blocks:
- Loopback: `localhost` / `127.0.0.1` / `[::1]` / `0.0.0.0`
- Private RFC 1918 ranges: `10.x`, `172.16-31.x`, `192.168.x`
- IPv4-mapped IPv6: `[::ffff:*]`
- Cloud metadata: `169.254.169.254`, `metadata.google.internal`
- Internal hostnames: `.internal`, `.local`
- `file://` protocol

### Channel Security

- **Telegram** — per-user allowlist (`allowFrom` supports @username and numeric ID), group chat mention requirements
- **Discord** — server-level access control via Discord permissions
- **Signal** — phone number allowlist (`allowFrom`)
- All channels support per-chat message queuing to prevent race conditions

### Plugins

- In-process execution (trust boundary = user's machine)
- Local-only loading (no remote plugin fetching)
- Plugins respect agent-level tool policy restrictions

### Supply Chain Security

- **Pinned dependencies** — all versions in `package.json` use exact versions (no `^` or `~` ranges)
- **Lockfile committed** — `package-lock.json` committed; CI uses `npm ci` for reproducible installs
- **Minimal dependency tree** — 4 runtime dependencies (commander, grammy, json5, ws)
- **npm audit clean** as of v1.11.1
- **npm 2FA** — publishing requires two-factor authentication on the maintainer's npm account

---

## Known Limitations

- Bash blocklist is defense-in-depth, not exhaustive — the confirmation system is the primary safety mechanism
- Plugin system has no sandboxing — plugins have full process access
- Config file uses default OS permissions — may be world-readable on multi-user Linux systems (use `chmod 600`)
- Behavioral guardrails (system prompt) depend on model compliance — smaller models may not always follow safety instructions

See [THREAT_MODEL.md](docs/THREAT_MODEL.md) for a complete assessment of what we defend against and what we don't.
