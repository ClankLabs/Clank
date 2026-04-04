# Clank Labs Alignment Practices

How we think about AI safety, transparency, and user trust.

> **Security Notice:** Clank gives AI agents full access to your file system, shell, and connected services. **We strongly recommend running Clank on dedicated hardware** (dev machine, VM, or container) rather than on systems with sensitive personal data or credentials you don't want the agent to access. See the [Threat Model](THREAT_MODEL.md) for details.

---

## Philosophy

Clank Labs builds on a simple principle: **you should be able to see exactly how your AI agent thinks and what instructions it follows.**

We publish system prompts. We publish training data. We don't hide model behavior behind proprietary guardrails that users can't inspect or modify. If the agent does something, you can trace it back to the prompt, the config, or the model's own behavior -- and you can change any of those.

This isn't about ideology. It's about building tools that developers actually trust enough to give filesystem and shell access to. Opacity kills trust, and trust is the whole product.

## Why This Exists

The API token race is turning AI-assisted development into a luxury. There are people with builder brain -- ideas, drive, and the itch to create -- who got locked out by the cost of entry. People who wanted to be developers their whole lives but got pulled into other jobs, with no free time and no budget for hundreds a month in API fees. Clank Labs exists so those people can build with capable AI on their own hardware, for free. If we can make that possible, our goals are met.

---

## System Prompt

The full system prompt that shapes agent behavior is published in source code at `src/engine/system-prompt.ts`. You can read every word of it.

The system prompt is assembled from:

- **Base instructions** -- Core behavioral rules, tool usage patterns, safety guidelines.
- **Workspace files** -- User-editable files that customize agent behavior:
  - `SOUL.md` -- Personality and communication style.
  - `USER.md` -- Information about the user (preferences, skill level, project context).
  - `IDENTITY.md` -- The agent's name, personality traits, emoji.
  - `MEMORY.md` -- Persistent memories the agent accumulates over time.
  - `TOOLS.md` -- Tool access configuration.
  - `AGENTS.md` -- Agent definitions.

All workspace files are plain text in your project directory. Edit them however you want. The agent adapts.

---

## Behavioral Guardrails

### System File Protection

The agent is trained to stay within the workspace unless the user explicitly names an outside path. If you ask it to "clean up temp files," it works within the project directory, not `/tmp` or `C:\Windows\Temp`. If you say "edit `/etc/nginx/nginx.conf`," it will -- because you named the file.

This is a behavioral boundary enforced through the system prompt, not a hard technical restriction. The agent has the access; the prompt tells it when to use it.

### Destructive Action Warnings

The system prompt trains the agent to pause and confirm before:

- Recursive deletes (`rm -rf`, especially outside the workspace)
- Git history rewrites (`git reset --hard`, `git push --force`)
- System-level changes (service restarts, config overwrites)
- Bulk file operations that can't easily be undone

The agent should explain what it's about to do and why, then wait for confirmation. Compliance depends on the model -- frontier models follow these instructions reliably; smaller local models may not always pause.

### Tool Restraint

The agent is trained to know when **not** to use tools. Not every question requires reading a file. Not every task requires running a command. The system prompt emphasizes reasoning before acting and avoiding unnecessary tool calls that waste context and tokens.

---

## Training Data

The Wrench model training dataset is published and auditable. Every training example teaches a specific behavior:

- **Use tools proactively** -- Don't ask "would you like me to read the file?" Just read it.
- **Warn before destructive actions** -- Explain what will happen, then ask for confirmation.
- **Ask for clarification when ambiguous** -- If a request could mean two different things, ask. Don't guess and risk the wrong action.
- **Stay focused** -- Do what was asked. Don't add unrequested features, create unrequested files, or go on tangents.

The dataset teaches helpfulness and caution simultaneously. A good agent is one that gets things done efficiently while catching the cases where "getting things done" means breaking something.

---

## What We Log

Nothing.

- **Zero telemetry.** The gateway does not phone home, ping analytics services, or report usage data.
- **No conversation logging.** Your conversations with the agent are stored locally in session files that you control. We never see them.
- **No usage analytics.** We don't know how many people use Clank, how often they use it, or what they use it for.

The gateway is a local process on your machine. It talks to your configured AI providers and nothing else. If you run Ollama locally, the entire pipeline -- gateway, model, tools -- runs without ever touching the internet.

If hosted Wrench becomes available in the future, conversations will not be stored or used for training. That's a commitment, not a feature flag.

---

## What We Don't Do

- **We don't train on user data.** Not now, not planned. Your conversations, your code, your files -- none of it feeds back to us.
- **We don't collect usage metrics.** We genuinely don't know our user count. We find out people use Clank when they open GitHub issues.
- **We don't have a "safety team" reviewing conversations.** There's no backend, no moderation pipeline, no human review of what you say to your agent.
- **We don't gate features behind safety theater.** If a tool is available, it's available. We tell you the risks (see [THREAT_MODEL.md](THREAT_MODEL.md)) and let you decide.

Your data is yours. Your agent is yours. Your config is yours.

---

## Limitations

Transparency about what we can't guarantee:

### Local Models Hallucinate

Smaller local models are less reliable at following safety instructions. A 7B model might not pause before a destructive action the way Claude or GPT-4o would. If you're using a local model for autonomous tasks (Telegram, Discord, cron pipelines), monitor it more closely.

### The Bash Blocklist Is a Safety Net

The 32-pattern blocklist catches the obvious cases: `rm -rf /`, fork bombs, disk formatting, nested shell payloads, and interpreter escapes. It does not catch a model that uses variable expansion to construct commands at runtime. It's a first line of defense, not a guarantee. See the [threat model](THREAT_MODEL.md) for details.

### Prompt Compliance Varies by Model

Behavioral guardrails live in the system prompt. How well the agent follows them depends entirely on the model. Frontier models (Claude, GPT-4o, Gemini) follow complex instructions reliably. Smaller or older models may skip warnings, ignore confirmation requests, or misinterpret safety rules.

### Non-Interactive Channels Need Attention

When the agent runs in Telegram, Discord, or Signal, it acts autonomously. Telegram and Discord now provide inline tool approval buttons (Approve / Always / Deny), but Signal auto-approves all tools. Review conversation history periodically, especially for long-running tasks.

---

We build these practices because they're the right way to make developer tools, not because a compliance checklist told us to. If you think we're missing something or doing something wrong, open an issue.
