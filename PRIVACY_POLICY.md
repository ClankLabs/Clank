# Privacy Policy

**Revision:** 2.0
**Effective Date:** 2026-03-27
**Last Updated:** 2026-03-27

---

## Overview

Clank is a local-first AI agent harness. **Your data stays on your machine.** We collect nothing.

---

## Data Collection

**Clank collects no data.** Zero telemetry, zero analytics, zero usage tracking. The harness is a local process — it does not phone home, ping analytics services, or report anything to us.

We genuinely don't know how many people use Clank. We find out when people open GitHub issues.

---

## Data Storage

All data is stored locally on your machine:

| Data | Location | Encryption |
|------|----------|------------|
| Configuration | `~/.clank/config.json5` | API keys encrypted (AES-256-GCM) |
| Sessions | `~/.clank/conversations/` | Optional encryption |
| Memory | `~/.clank/memory/` | Plaintext (local only) |
| Workspace | `~/.clank/workspace/` | Plaintext (local only) |
| Cron jobs | `~/.clank/cron/` | Plaintext (local only) |
| Logs | `~/.clank/logs/` | Plaintext (local only) |

On Windows, `~/.clank/` is `%APPDATA%\Clank\`.

---

## External Connections

Clank connects to external services **only when you configure them**:

| Service | When | What's sent |
|---------|------|-------------|
| **Local models** (Ollama, llama.cpp, LM Studio, vLLM) | Always if configured | Prompts and responses — **never leaves your machine** |
| **Cloud LLMs** (Anthropic, OpenAI, Google, OpenRouter) | When configured as provider | Prompts and responses sent to the provider you chose |
| **Telegram** | When bot is configured | Messages sent through Telegram's API |
| **Discord** | When bot is configured | Messages sent through Discord's API |
| **Signal** | When adapter is configured | Messages sent through signal-cli (local daemon) |
| **Web search** (Brave) | When agent uses web_search | Search queries sent to Brave Search API |
| **Voice** (ElevenLabs, Groq) | When voice is configured | Audio sent for TTS/STT processing |

**Local-only voice** (whisper.cpp + piper) never leaves your machine.

---

## LLM Context Protection

When using cloud providers, your prompts and responses are sent to the provider. However:

- **API keys are never sent to the LLM** — config is redacted before injection into agent context
- **Bot tokens are never sent to the LLM** — same redaction applies
- **Auth tokens are never sent to the LLM** — harness credentials stay out of conversation history
- **Local models never leave your machine** — all processing is local

---

## Your Rights

Your data is yours. There is no cloud account, no remote backup, nothing to request deletion of.

- **Delete everything:** `clank uninstall` removes all data, the system service, and the npm package
- **Delete manually:** remove `~/.clank/` (macOS/Linux) or `%APPDATA%\Clank\` (Windows)
- **Selective deletion:** delete specific session files from `~/.clank/conversations/`

---

## Third-Party Providers

When you use cloud LLM providers, your data is subject to **their** privacy policies:

- [Anthropic Privacy Policy](https://www.anthropic.com/privacy)
- [OpenAI Privacy Policy](https://openai.com/policies/privacy-policy)
- [Google AI Privacy](https://ai.google/responsibility/privacy/)

Clank does not add to, modify, or intercept your data beyond what's needed to route it to the provider you configured.

---

## Changes

| Rev | Date | Change |
|-----|------|--------|
| 2.0 | 2026-03-27 | Rewritten for v1.8.x. Added Signal, web search, third-party provider links, Windows paths. |
| 1.1 | 2026-03-22 | Added LLM context protection, config redaction, uninstall command |
| 1.0 | 2026-03-22 | Initial privacy policy |
