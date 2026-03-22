/**
 * `clank setup` — Onboarding wizard.
 *
 * Gets the user from install to chatting in under 2 minutes.
 * Auto-detects local models, configures the gateway, and sets up
 * the user's preferred interface.
 *
 * Two flows:
 * - Quick Start: sensible defaults, minimal questions
 * - Advanced: full control over everything
 */

import { createInterface } from "node:readline";
import { randomBytes } from "node:crypto";
import {
  loadConfig,
  saveConfig,
  ensureConfigDir,
  defaultConfig,
  getConfigDir,
  type ClankConfig,
} from "../config/index.js";
import { detectLocalServers } from "../providers/index.js";
import { installDaemon } from "../daemon/index.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runSetup(opts: {
  quick?: boolean;
  advanced?: boolean;
  section?: string;
  nonInteractive?: boolean;
  acceptRisk?: boolean;
}): Promise<void> {
  await ensureConfigDir();
  const config = defaultConfig();

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    // Step 1: Welcome & Security
    console.log("");
    console.log(bold("  Welcome to Clank"));
    console.log("");
    console.log("  Clank is an AI agent that can read, write, and");
    console.log("  delete files, execute commands, and access the web.");
    console.log("  Review actions carefully.");
    console.log("");

    if (!opts.acceptRisk) {
      const ack = await ask(rl, cyan("  I understand, continue? [Y/n] "));
      if (ack.toLowerCase() === "n") {
        console.log(dim("  Setup cancelled."));
        return;
      }
    }

    // Step 2: Choose Flow
    let isAdvanced = opts.advanced || false;
    if (!opts.quick && !opts.advanced) {
      console.log("");
      console.log("  How would you like to set up Clank?");
      console.log("");
      console.log("  1. " + bold("Quick Start") + " (recommended)");
      console.log(dim("     Auto-detect local models, sensible defaults"));
      console.log("  2. Advanced");
      console.log(dim("     Full control over gateway, models, channels"));
      console.log("");
      const choice = await ask(rl, cyan("  Choice [1]: "));
      isAdvanced = choice === "2";
    }

    // Step 3: Model Provider Setup
    console.log("");
    console.log(dim("  Searching for local models..."));
    const servers = await detectLocalServers();

    if (servers.length > 0) {
      const primary = servers[0];
      console.log(green(`  Found ${primary.provider} at ${primary.baseUrl}`));
      console.log(dim(`    Models: ${primary.models.slice(0, 5).join(", ")}`));

      const defaultModel = primary.models[0] || "qwen3.5";
      const useDefault = await ask(rl, cyan(`  Use ${primary.provider}/${defaultModel} as default? [Y/n] `));
      if (useDefault.toLowerCase() !== "n") {
        config.agents.defaults.model.primary = `${primary.provider}/${defaultModel}`;
        if (primary.provider === "ollama") {
          config.models.providers.ollama = { baseUrl: primary.baseUrl };
        }
      }
    } else {
      console.log(yellow("  No local model server detected."));
      console.log(dim("  Install Ollama (recommended) or configure a cloud provider."));
    }

    // Step 3b: Cloud fallback (optional)
    if (isAdvanced) {
      console.log("");
      const addCloud = await ask(rl, cyan("  Add a cloud provider as fallback? [y/N] "));
      if (addCloud.toLowerCase() === "y") {
        const key = await ask(rl, cyan("  Enter Anthropic API key: "));
        if (key.trim()) {
          config.models.providers.anthropic = { apiKey: key.trim() };
          config.agents.defaults.model.fallbacks = ["anthropic/claude-sonnet-4-6"];
          console.log(green("  Anthropic configured as fallback"));
        }
      }
    }

    // Step 4: Gateway Configuration
    if (isAdvanced) {
      console.log("");
      console.log(dim("  Gateway settings:"));
      const port = await ask(rl, cyan(`  Port [${config.gateway.port}]: `));
      if (port.trim()) config.gateway.port = parseInt(port, 10);
    }

    // Generate auth token
    config.gateway.auth.token = randomBytes(16).toString("hex");
    console.log(dim(`  Gateway token: ${config.gateway.auth.token.slice(0, 8)}...`));

    // Step 5: Workspace Bootstrap
    console.log("");
    console.log(dim("  Creating workspace..."));
    // Workspace templates are created by ensureConfigDir + first agent run
    console.log(green("  Workspace ready at " + getConfigDir()));

    // Step 6: Channel Setup
    if (isAdvanced) {
      console.log("");
      console.log("  Channels (configure through conversation after setup):");
      console.log(dim("    Web UI:    enabled by default"));
      console.log(dim("    CLI:       always available"));
      console.log(dim("    Telegram:  tell your agent to set it up"));
      console.log(dim("    Discord:   tell your agent to set it up"));
    }

    // Step 10: Daemon Install
    console.log("");
    const installService = await ask(rl, cyan("  Install as system service? [Y/n] "));
    if (installService.toLowerCase() !== "n") {
      try {
        await installDaemon();
      } catch (err) {
        console.log(yellow(`  Skipped: ${err instanceof Error ? err.message : err}`));
      }
    }

    // Save config
    await saveConfig(config);
    console.log(green("\n  Config saved to " + getConfigDir() + "/config.json5"));

    // Step 11: First Chat
    console.log("");
    console.log(bold("  Clank is ready!"));
    console.log("");
    console.log("  Start chatting:");
    console.log(dim("    clank chat          — CLI chat"));
    console.log(dim("    clank chat --web    — Open in browser"));
    console.log(dim("    clank gateway start — Start the daemon"));
    console.log("");
  } finally {
    rl.close();
  }
}
