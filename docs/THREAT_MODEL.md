# Clank Gateway Threat Model

An honest assessment of what Clank defends against and what it doesn't.

**Version:** 1.11.0 | **Last Updated:** 2026-03-30

---

## Scope

Clank Gateway is a **developer tool with full system access**. It runs locally, connects to AI models, and executes shell commands, file operations, and git actions on behalf of the user.

It is designed for **developers running it on dedicated or sandboxed hardware** -- personal workstations, dev VMs, or homelab servers. It is not designed for multi-tenant environments, public-facing deployments, or untrusted users.

---

## Trust Model

The agent has full filesystem and shell access. **This is intentional.**

Clank is a coding assistant. Its entire value comes from being able to read your code, edit your files, run your tests, and commit your changes. Restricting it to a sandbox would make it useless for its intended purpose.

The trust boundary works like this:

- **The user trusts the agent** to act on their behalf within the configured workspace.
- **The agent trusts the provider** to return well-formed responses (but validates tool calls before execution).
- **The gateway trusts the config** to define which models, agents, and channels are active.
- **Nothing trusts the network** -- all credential storage uses AES-256-GCM, and the gateway does not expose secrets via its API.

If you don't trust the model you're running, you shouldn't give it tool access. Clank gives you that choice per-agent in the config.

---

## What We Defend Against

### Bash Command Blocklist (25 patterns)

The gateway maintains a blocklist of 25 shell command patterns known to be destructive or dangerous:

- Filesystem destruction (`rm -rf /`, `rm -rf ~`, `rm -rf *`)
- Disk-level operations (`mkfs`, `dd if=`)
- Fork bombs (`:(){`)
- Privilege escalation patterns (`chmod 777 /`, `chown root`)
- System-critical paths (`/etc/passwd`, `/etc/shadow`, `/boot`)
- Network exfiltration patterns (reverse shells, `nc -l`)

When a tool call matches a blocked pattern, the gateway rejects it and informs the model. The model can rephrase or ask the user for guidance.

### SSRF Protection

The `web_fetch` tool blocks requests to:

- Private IPv4 ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- Link-local: `169.254.0.0/16` (including AWS metadata at `169.254.169.254`)
- Loopback: `127.0.0.0/8`
- IPv6 equivalents: `::1`, `fc00::/7`, `fe80::/10`

This prevents a compromised or hallucinating model from using Clank as a proxy to scan internal networks or steal cloud credentials from metadata services.

### Prototype Pollution Prevention

All JSON-RPC input and tool parameters are validated to prevent prototype pollution attacks. Properties like `__proto__`, `constructor`, and `prototype` are rejected at the parsing layer.

### Config Redaction

API keys, tokens, and secrets stored in the config are **never** exposed through:

- The JSON-RPC API
- Tool call results
- Agent conversation history
- Web UI state

When the config is read or displayed, sensitive fields are replaced with `[REDACTED]`.

### Rate Limiting

Default: **20 requests per minute per session.** This prevents a runaway agent loop from burning through API credits or overwhelming a local model.

### Filename Sanitization

All file paths in tool calls are sanitized to prevent path traversal:

- `../` sequences are resolved and checked against the workspace boundary.
- Null bytes are stripped.
- Symbolic links are resolved before access checks.

### Encrypted Credential Storage

Credentials stored by `clank setup` (API keys, OAuth tokens) are encrypted with **AES-256-GCM** using a machine-derived key. They are decrypted only in memory at gateway startup.

### System File Protection

The agent's system prompt instructs it not to modify files outside the workspace unless the user explicitly names them. This is a behavioral guardrail, not a hard enforcement -- see limitations below.

---

## What We Don't Defend Against

We believe in being honest about limitations. Here's what the security measures above do **not** cover:

### Bash Blocklist Bypass

A determined model can bypass the 25-pattern blocklist through indirect methods:

- Writing a script to disk and executing it
- Using language interpreters (`python -c "import os; os.system(...)"`)
- Chaining innocuous commands in unexpected ways
- Using aliases or environment variables to obscure intent

The blocklist catches obvious mistakes and hallucinated destructive commands. It is a **safety net**, not a security boundary.

### Model Hallucinations

Local models (and sometimes cloud models) can hallucinate dangerous actions. A model might:

- Confidently delete the wrong file
- Run a command it doesn't fully understand
- Misinterpret an ambiguous request as a destructive one

No amount of prompt engineering eliminates this entirely. The system prompt trains the model to warn before destructive actions and ask for confirmation, but compliance varies by model.

### Agent-Level Access

The agent runs with the same permissions as the user who started the gateway. If you run Clank as root, the agent has root access. If you run it as your user, the agent can access everything your user can access.

There is no privilege separation between the gateway and the agent's tool execution.

### Network Exposure

Clank binds to `localhost` by default with token-based WebSocket authentication. However, if you expose the gateway to the network without additional protection, anyone with the auth token can interact with the agent.

For remote access, use SSH tunneling, a VPN, or a reverse proxy with its own authentication layer.

### Channel-Level Trust

Messages from Telegram, Discord, and Signal are treated as user input. If someone has access to your Telegram bot, Discord server, or Signal number, they can instruct the agent.

Clank provides per-channel allowlists:
- **Telegram** — `allowFrom` with @usernames or numeric IDs
- **Signal** — `allowFrom` with phone numbers
- **Discord** — relies on Discord's own server permission system

These are authentication mechanisms, not authorization. Any allowed user has full agent access.

---

## Recommendations

1. **Run on dedicated hardware or a VM.** Don't run Clank on a machine with sensitive data outside your dev workspace unless you're comfortable with the agent having access to it.

2. **Don't expose the gateway to the public internet.** If you need remote access, use SSH tunneling, a VPN, or a reverse proxy with authentication.

3. **Review agent actions in non-interactive channels.** When using Telegram or Discord, the agent acts autonomously. Check in on what it's doing, especially for long-running tasks.

4. **Keep models updated.** Newer model versions tend to follow safety instructions more reliably.

5. **Use per-agent model assignment thoughtfully.** Don't give a small local model the same tool access as a frontier model if you're concerned about hallucinated actions.

6. **Don't run as root.** Run the gateway as a regular user with access only to the directories you want the agent to work in.

---

## Reporting Security Issues

If you find a security vulnerability in Clank Gateway:

- **GitHub Issues:** Open an issue at [github.com/ClankLabs/Clank](https://github.com/ClankLabs/Clank/issues) with the `security` label.
- **Email:** Reach out directly if the issue is sensitive and shouldn't be disclosed publicly before a fix is available.

We take security reports seriously and will respond promptly. If you've found a way to bypass a protection that's listed in this document, we want to know.
