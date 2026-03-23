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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
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
        // Save the detected server URL for ALL local providers
        (config.models.providers as Record<string, unknown>)[primary.provider] = { baseUrl: primary.baseUrl };
      }
    } else {
      console.log(yellow("  No local model server detected."));
      console.log(dim("  Install Ollama (recommended) or configure a cloud provider."));
    }

    // Step 3b: Cloud provider (optional fallback)
    console.log("");
    const addCloud = await ask(rl, cyan("  Add a cloud provider as fallback? [y/N] "));
    if (addCloud.toLowerCase() === "y") {
      console.log(dim("    1. Anthropic (Claude)"));
      console.log(dim("    2. OpenAI (GPT)"));
      console.log(dim("    3. Google (Gemini)"));
      const provider = await ask(rl, cyan("    Which provider? [1]: "));

      switch (provider || "1") {
        case "1": {
          const key = await ask(rl, cyan("    Anthropic API key: "));
          if (key.trim()) {
            config.models.providers.anthropic = { apiKey: key.trim() };
            config.agents.defaults.model.fallbacks = ["anthropic/claude-sonnet-4-6"];
            console.log(green("    Anthropic configured as fallback"));
          }
          break;
        }
        case "2": {
          const key = await ask(rl, cyan("    OpenAI API key: "));
          if (key.trim()) {
            config.models.providers.openai = { apiKey: key.trim() };
            config.agents.defaults.model.fallbacks = ["openai/gpt-4o"];
            console.log(green("    OpenAI configured as fallback"));
          }
          break;
        }
        case "3": {
          const key = await ask(rl, cyan("    Google AI API key: "));
          if (key.trim()) {
            config.models.providers.google = { apiKey: key.trim() };
            config.agents.defaults.model.fallbacks = ["google/gemini-2.0-flash"];
            console.log(green("    Google configured as fallback"));
          }
          break;
        }
      }
    }

    // Step 4: Gateway Configuration
    console.log("");
    console.log(dim("  Gateway settings:"));
    if (isAdvanced) {
      const port = await ask(rl, cyan(`    Port [${config.gateway.port}]: `));
      if (port.trim()) config.gateway.port = parseInt(port, 10);
    }

    // Generate auth token
    config.gateway.auth.token = randomBytes(16).toString("hex");
    console.log(dim(`    Port: ${config.gateway.port}`));
    console.log(dim(`    Token: ${config.gateway.auth.token.slice(0, 8)}...`));

    // Step 5: Workspace Bootstrap
    console.log("");
    console.log(dim("  Creating workspace..."));
    const { ensureWorkspaceFiles } = await import("../engine/system-prompt.js");
    const templateDir = join(__dirname, "..", "workspace", "templates");
    const wsDir = join(getConfigDir(), "workspace");
    try {
      await ensureWorkspaceFiles(wsDir, templateDir);
    } catch {
      // Templates may not be found in built version — that's ok
    }
    console.log(green("  Workspace ready at " + getConfigDir()));

    // Step 6: Channel Setup
    console.log("");
    console.log("  Channel setup:");
    console.log(dim("    Web UI and CLI are always available."));
    console.log("");

    const addTelegram = await ask(rl, cyan("  Connect Telegram bot? [y/N] "));
    if (addTelegram.toLowerCase() === "y") {
      console.log(dim("    1. Message @BotFather on Telegram"));
      console.log(dim("    2. Send /newbot and follow prompts"));
      console.log(dim("    3. Copy the bot token"));
      const token = await ask(rl, cyan("    Bot token: "));
      if (token.trim()) {
        config.channels.telegram = { enabled: true, botToken: token.trim() };
        const userId = await ask(rl, cyan("    Your Telegram user ID (for allowlist): "));
        if (userId.trim()) {
          config.channels.telegram.allowFrom = [userId.trim()];
        }
        console.log(green("    Telegram configured"));
      }
    }

    const addDiscord = await ask(rl, cyan("  Connect Discord bot? [y/N] "));
    if (addDiscord.toLowerCase() === "y") {
      console.log(dim("    1. Go to discord.com/developers/applications"));
      console.log(dim("    2. Create app → Bot → Copy Token"));
      console.log(dim("    3. Enable MESSAGE CONTENT intent"));
      const token = await ask(rl, cyan("    Bot token: "));
      if (token.trim()) {
        config.channels.discord = { enabled: true, botToken: token.trim() };
        console.log(green("    Discord configured"));
      }
    }

    // Step 7: Web Search (Brave)
    console.log("");
    const addSearch = await ask(rl, cyan("  Set up web search (Brave Search)? [y/N] "));
    if (addSearch.toLowerCase() === "y") {
      console.log(dim("    Get a free API key at: https://brave.com/search/api/"));
      const key = await ask(rl, cyan("    Brave Search API key: "));
      if (key.trim()) {
        config.tools.webSearch = { enabled: true, provider: "brave", apiKey: key.trim() };
        console.log(green("    Brave Search configured"));
      }
    }

    // Step 8: Integrations (API services)
    console.log("");
    console.log("  API Integrations:");
    console.log(dim("    Add third-party services for voice, image gen, etc."));
    console.log(dim("    You can also configure these later through conversation."));
    console.log("");

    const addElevenLabs = await ask(rl, cyan("  Set up ElevenLabs (text-to-speech)? [y/N] "));
    if (addElevenLabs.toLowerCase() === "y") {
      console.log(dim("    Get an API key at: https://elevenlabs.io/"));
      const key = await ask(rl, cyan("    ElevenLabs API key: "));
      if (key.trim()) {
        config.integrations.elevenlabs = { enabled: true, apiKey: key.trim() };
        const voiceId = await ask(rl, cyan("    Default voice ID (Enter to skip): "));
        if (voiceId.trim()) {
          config.integrations.elevenlabs.voiceId = voiceId.trim();
        }
        console.log(green("    ElevenLabs configured (TTS available)"));
      }
    }

    const addWhisper = await ask(rl, cyan("  Set up speech-to-text (Whisper)? [y/N] "));
    if (addWhisper.toLowerCase() === "y") {
      console.log(dim("    1. OpenAI Whisper API (cloud, uses OpenAI key)"));
      console.log(dim("    2. Local whisper.cpp (requires whisper installed)"));
      const whisperChoice = await ask(rl, cyan("    Choice [1]: "));
      if (whisperChoice === "2") {
        config.integrations.whisper = { enabled: true, provider: "local" };
        console.log(green("    Local whisper.cpp configured"));
        console.log(dim("    Make sure whisper is installed and in PATH"));
      } else {
        // OpenAI Whisper — can reuse existing OpenAI key or add one
        const existingKey = config.models.providers.openai?.apiKey;
        if (existingKey) {
          config.integrations.whisper = { enabled: true, provider: "openai", apiKey: existingKey };
          console.log(green("    Whisper configured (using existing OpenAI key)"));
        } else {
          const key = await ask(rl, cyan("    OpenAI API key for Whisper: "));
          if (key.trim()) {
            config.integrations.whisper = { enabled: true, provider: "openai", apiKey: key.trim() };
            console.log(green("    Whisper configured"));
          }
        }
      }
    }

    // Step 9: Agents (Advanced only)
    if (isAdvanced) {
      console.log("");
      const addAgents = await ask(rl, cyan("  Define additional agents? [y/N] "));
      if (addAgents.toLowerCase() === "y") {
        let adding = true;
        while (adding) {
          const id = await ask(rl, cyan("    Agent ID: "));
          if (!id.trim()) break;
          const name = await ask(rl, cyan("    Name: "));
          const model = await ask(rl, cyan("    Model [default]: "));

          config.agents.list.push({
            id: id.trim(),
            name: name.trim() || id.trim(),
            model: model.trim() ? { primary: model.trim() } : undefined,
          });
          console.log(green(`    Agent ${id.trim()} added`));

          const more = await ask(rl, cyan("    Add another? [y/N] "));
          adding = more.toLowerCase() === "y";
        }
      }
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
