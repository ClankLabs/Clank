# Clank Privacy Policy

**Revision:** 1.1
**Effective Date:** 2026-03-22
**Last Updated:** 2026-03-22

---

## Overview

Clank is a local-first AI agent gateway. Your data stays on your machine.

## Data Collection

**Clank collects no data.** The application runs entirely on your local machine. No telemetry, no analytics, no usage tracking.

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

## External Connections

Clank connects to external services **only when you configure them**:

- **LLM Providers** (Ollama, Anthropic, OpenAI, Google) — Your prompts and responses are sent to the provider you choose. Local models (Ollama) never leave your machine.
- **Channel Platforms** (Telegram, Discord, Slack) — Messages are sent through the platform's API when you configure a bot.
- **Web Search** (Brave, Google) — Search queries are sent to the provider you choose.
- **Voice** (ElevenLabs) — Audio is sent to the provider for TTS/STT. Local voice (whisper.cpp + piper) never leaves your machine.

## API Keys

API keys are encrypted at rest using AES-256-GCM with PBKDF2-derived keys (100,000 iterations, SHA-256). Keys are only decrypted in memory when needed for API calls.

## Gateway Security

- The gateway binds to localhost by default (not accessible from the network)
- Token-based authentication for all WebSocket client connections
- Auto-generated auth token if none configured
- `/status` endpoint requires authentication
- No remote access unless explicitly configured

## LLM Context Protection

When using cloud LLM providers (Anthropic, OpenAI, Google), your prompts and agent responses are sent to the provider. However:

- **API keys are never sent to the LLM** — config is redacted before injection into agent context
- **Bot tokens are never sent to the LLM** — same redaction applies
- **Local models (Ollama, llama.cpp, etc.) never leave your machine** — all processing is local

## Your Rights

Your data is yours. Delete `~/.clank/` to remove everything, or run `clank uninstall` to remove all data, the system service, and the npm package. There is no cloud account, no remote backup, nothing to request deletion of.

## Changes

| Rev | Date | Change |
|-----|------|--------|
| 1.1 | 2026-03-22 | Added LLM context protection, config redaction, uninstall command |
| 1.0 | 2026-03-22 | Initial privacy policy for Clank Gateway |
