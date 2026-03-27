/**
 * CLI chat command — direct mode.
 *
 * This is the simplest way to use Clank: `clank chat` starts an
 * interactive session in the terminal. In direct mode (no gateway),
 * it spawns an AgentEngine inline and talks to it directly.
 *
 * Later (Sprint 2), this will also support connecting to a running
 * gateway via WebSocket. But direct mode always works as a fallback.
 */

import { createInterface } from "node:readline";
import { join } from "node:path";
import { AgentEngine, type AgentIdentity, buildSystemPrompt } from "../engine/index.js";
import { createFullRegistry } from "../tools/index.js";
import { createProvider, resolveWithFallback } from "../providers/router.js";
import { OllamaProvider } from "../providers/ollama.js";
import { loadConfig, ensureConfigDir, getConfigDir } from "../config/index.js";
import { SessionStore } from "../sessions/index.js";

/** ANSI color helpers */
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export async function runChat(opts: {
  new?: boolean;
  continue?: boolean;
  session?: string;
  direct?: boolean;
  web?: boolean;
}): Promise<void> {
  await ensureConfigDir();
  const config = await loadConfig();

  // --web flag: start gateway if needed and open browser
  if (opts.web) {
    const port = config.gateway.port || 18789;
    const token = config.gateway.auth.token || "";

    // Check if gateway is running
    let gatewayRunning = false;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
      gatewayRunning = res.ok;
    } catch {}

    if (!gatewayRunning) {
      // Start gateway in background
      console.log(dim("Starting gateway..."));
      const { spawn } = await import("node:child_process");
      const { fileURLToPath } = await import("node:url");
      const { dirname, join } = await import("node:path");
      const __filename = fileURLToPath(import.meta.url);
      const entryPoint = join(dirname(__filename), "index.js");

      const child = spawn(process.execPath, [entryPoint, "gateway", "start", "--foreground"], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();

      // Wait for gateway to be ready
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) });
          if (res.ok) { gatewayRunning = true; break; }
        } catch {}
      }

      if (!gatewayRunning) {
        console.log(red("Failed to start gateway. Try: clank gateway start"));
        return;
      }
      console.log(green("Gateway started."));
    }

    // Open browser
    const url = `http://127.0.0.1:${port}/#token=${token}`;
    console.log(dim(`Opening ${url}`));
    const { platform } = await import("node:os");
    const { exec } = await import("node:child_process");
    const openCmd = platform() === "win32" ? `start "" "${url}"` : platform() === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(openCmd);
    console.log(green("Web UI opened in browser."));
    return;
  }

  // Resolve model and create provider
  const modelConfig = config.agents.defaults.model;
  console.log(dim(`Connecting to ${modelConfig.primary}...`));

  let resolved;
  try {
    resolved = await resolveWithFallback(
      modelConfig.primary,
      modelConfig.fallbacks || [],
      config.models.providers,
      { maxResponseTokens: config.agents.defaults.maxResponseTokens },
    );
    console.log(green(`  Connected to ${resolved.modelId}${resolved.isLocal ? " (local)" : " (cloud)"}`));
  } catch (err) {
    console.error(red(`Failed to connect to any model: ${err instanceof Error ? err.message : err}`));
    console.error(dim("Make sure Ollama is running or configure a cloud provider in ~/.clank/config.json5"));
    process.exit(1);
  }

  // Initialize session store
  const sessionStore = new SessionStore(join(getConfigDir(), "conversations"));
  await sessionStore.init();

  // Create tool registry — full registry includes self-config tools
  const toolRegistry = createFullRegistry();

  // Create agent identity
  const identity: AgentIdentity = {
    id: "default",
    name: "Clank",
    model: modelConfig,
    workspace: config.agents.defaults.workspace || process.cwd(),
    toolTier: config.agents.defaults.toolTier || "auto",
    temperature: config.agents.defaults.temperature,
    maxResponseTokens: config.agents.defaults.maxResponseTokens,
  };

  // Build system prompt from workspace files
  const systemPrompt = await buildSystemPrompt({
    identity,
    workspaceDir: identity.workspace,
    channel: "cli",
  });

  // Create engine
  const engine = new AgentEngine({
    identity,
    toolRegistry,
    sessionStore,
    provider: resolved,
    autoApprove: config.tools.autoApprove,
    systemPrompt,
  });

  // Load session
  const sessionKey = opts.session || "cli:main";
  await engine.loadSession(sessionKey, "cli");

  // Wire up events
  let isStreaming = false;

  engine.on("response-start", () => {
    isStreaming = true;
  });

  engine.on("token", ({ content }) => {
    process.stdout.write(content);
  });

  engine.on("response-end", ({ text }) => {
    if (isStreaming && text) {
      process.stdout.write("\n");
    }
    isStreaming = false;
  });

  engine.on("tool-start", ({ name, arguments: args }) => {
    const summary = args.command || args.path || args.pattern || args.args || "";
    console.log(dim(`  [${name}] ${String(summary).slice(0, 80)}`));
  });

  engine.on("tool-result", ({ name, success, summary }) => {
    const icon = success ? green("ok") : red("err");
    console.log(dim(`  [${name}] ${icon} ${summary.slice(0, 80)}`));
  });

  engine.on("confirm-needed", ({ actions, resolve }) => {
    const action = actions[0];
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(
      yellow(`  Confirm: ${action.description} [y/n/always] `),
      (answer) => {
        rl.close();
        const a = answer.trim().toLowerCase();
        if (a === "always" || a === "a") resolve("always");
        else if (a === "y" || a === "yes") resolve(true);
        else resolve(false);
      },
    );
  });

  engine.on("context-compacting", () => {
    console.log(dim("  (compacting context...)"));
  });

  engine.on("usage", ({ promptTokens, outputTokens, iterationCount, contextPercent }) => {
    console.log(dim(`  [${promptTokens}→${outputTokens} tokens | iter ${iterationCount} | ctx ${contextPercent}%]`));
  });

  engine.on("error", ({ message, recoverable }) => {
    console.error(red(`Error: ${message}${recoverable ? " (recoverable)" : ""}`));
  });

  // Print banner
  console.log("");
  console.log(cyan("   ___  _             _   "));
  console.log(cyan("  / __|| | __ _  _ _ | |__"));
  console.log(cyan(" | (__ | |/ _` || ' \\| / /"));
  console.log(cyan("  \\___||_|\\__,_||_||_|_\\_\\"));
  console.log(dim(`  v1.8.1 | ${resolved.modelId} | ${identity.toolTier} tier`));
  console.log(dim("  Type your message. Press Ctrl+C to exit.\n"));

  // Interactive readline loop
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: cyan("you > "),
  });

  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    // Slash commands
    if (input.startsWith("/")) {
      await handleSlashCommand(input, engine, rl);
      rl.prompt();
      return;
    }

    console.log("");
    try {
      await engine.sendMessage(input);
    } catch (err) {
      // Error already emitted via event
    }
    console.log("");
    rl.prompt();
  });

  rl.on("close", () => {
    engine.destroy();
    process.exit(0);
  });

  // Handle Ctrl+C during streaming
  process.on("SIGINT", () => {
    if (isStreaming) {
      engine.cancel();
      console.log(dim("\n  (cancelled)"));
      rl.prompt();
    } else {
      rl.close();
    }
  });
}

/** Handle slash commands */
async function handleSlashCommand(
  input: string,
  engine: AgentEngine,
  _rl: ReturnType<typeof createInterface>,
): Promise<void> {
  const [cmd, ...args] = input.slice(1).split(/\s+/);

  switch (cmd) {
    case "help":
      console.log(dim("Commands:"));
      console.log(dim("  /help     — Show this help"));
      console.log(dim("  /model    — Show current model"));
      console.log(dim("  /clear    — Clear conversation"));
      console.log(dim("  /exit     — Exit"));
      break;

    case "model":
      console.log(dim(`Model: ${engine.identity.model.primary}`));
      break;

    case "clear":
      engine.getContextEngine().clear();
      console.log(dim("Conversation cleared."));
      break;

    case "exit":
    case "quit":
      engine.destroy();
      process.exit(0);

    default:
      console.log(dim(`Unknown command: /${cmd}. Type /help for available commands.`));
  }
}
