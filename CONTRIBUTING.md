# Contributing to Clank

Welcome! Clank is an open-source, local-first AI agent harness. Contributions are welcome from everyone — whether you're fixing a typo, adding a provider, or training the next version of Wrench.

---

## Ways to Contribute

| Type | Description |
|------|-------------|
| **Code** | Harness features, bug fixes, new providers, new tools |
| **Training Data** | New JSONL examples for the [Wrench model](https://github.com/ClankLabs/wrench-training-data) |
| **Benchmark** | Test cases that push tool-calling accuracy |
| **Bug Reports** | File [GitHub Issues](https://github.com/ClankLabs/Clank/issues) with steps to reproduce |
| **Documentation** | Improvements to guides, inline comments, or wiki pages |

---

## Getting Started

```bash
git clone https://github.com/ClankLabs/Clank.git
cd Clank
npm install
npm run build        # tsup builds to dist/
clank setup          # first-time config wizard
clank                # start harness + TUI
```

### Project Structure

```
src/
  adapters/        # Telegram, Discord, Signal adapters + shared commands
  cli/             # CLI entry point, TUI, chat mode
  config/          # Config loader, hot-reload, redaction
  engine/          # AgentEngine (ReAct loop), ContextEngine, system prompt
  harness/         # WebSocket + HTTP server
  memory/          # TF-IDF memory engine
  providers/       # 8 provider adapters + prompt fallback
  tasks/           # Sub-agent task registry
  tools/           # 23 tool implementations + registry
  workspace/       # Workspace file templates
docs/              # User-facing documentation
```

---

## Code Style

- TypeScript with semicolons
- Keep it simple — if a function does one thing well, that's enough
- Use descriptive names. Avoid abbreviations unless universal (e.g., `config`, `msg`)
- Follow existing patterns. When in doubt, look at a neighboring file
- No unnecessary abstractions — three similar lines > a premature helper

---

## Training Data Format

Wrench training data lives in the [wrench-training-data](https://github.com/ClankLabs/wrench-training-data) repo as JSONL files. Each line is a self-contained JSON object with a `conversations` array.

Roles: `system`, `user`, `assistant`, `tool`.

Tool calls use the fenced ` ```tool_call ` block format. Tool results use the `tool` role.

**Example:**

```json
{
  "conversations": [
    { "role": "system", "content": "You are a helpful assistant with access to tools." },
    { "role": "user", "content": "What files are in the current directory?" },
    { "role": "assistant", "content": "I'll list the files for you.\n\n```tool_call\n{\"name\": \"list_directory\", \"arguments\": {\"path\": \".\"}}\n```" },
    { "role": "tool", "content": "README.md\npackage.json\nsrc/\ntsconfig.json" },
    { "role": "assistant", "content": "The current directory contains README.md, package.json, a src/ folder, and tsconfig.json." }
  ]
}
```

Each example should demonstrate a realistic, complete interaction. Include the system prompt, at least one user turn, and the full tool-call round trip.

---

## Pull Requests

1. Fork the repo and create a feature branch (`git checkout -b my-feature`)
2. Make your changes and test locally (`npm run build`)
3. Open a PR against `main`
4. Keep PRs focused — one feature or fix per PR
5. Describe **what** changed and **why** in the PR description

---

## Issues

Use [GitHub Issues](https://github.com/ClankLabs/Clank/issues) for bugs and feature requests.

For bugs, include:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Clank version (`clank --version`), OS, and provider/model if relevant

---

## Community

- **Website:** [clanklabs.dev](https://clanklabs.dev)
- **Twitter/X:** [@Clank_Labs](https://x.com/Clank_Labs)
- **Reddit:** [u/ClankLabs](https://reddit.com/u/ClankLabs)

Be respectful — we're all here to build something useful.
