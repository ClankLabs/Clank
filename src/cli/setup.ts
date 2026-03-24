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

  // Load existing config so users can keep pre-existing values.
  // Fall back to defaults for anything missing.
  let config: ClankConfig;
  try {
    config = await loadConfig();
  } catch {
    config = defaultConfig();
  }

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

    // Step 3b: Cloud providers (add multiple)
    console.log("");

    // Show existing providers
    const existingProviders: string[] = [];
    const providers = config.models.providers as Record<string, { apiKey?: string } | undefined>;
    for (const name of ["anthropic", "openai", "google", "openrouter"]) {
      if (providers[name]?.apiKey) existingProviders.push(name);
    }
    if (existingProviders.length > 0) {
      console.log(dim(`  Existing cloud providers: ${existingProviders.join(", ")}`));
    }

    const addCloud = await ask(rl, cyan("  Add cloud providers? [y/N] "));
    if (addCloud.toLowerCase() === "y") {
      const fallbacks: string[] = config.agents.defaults.model.fallbacks || [];
      let picking = true;
      while (picking) {
        console.log("");
        console.log("    1. Anthropic (Claude)");
        console.log("    2. OpenAI (GPT-4o, Codex)");
        console.log("    3. Google (Gemini)");
        console.log("    4. OpenRouter (many models via one key)");
        console.log("    5. OpenCode (subscription-based, many models)");
        console.log("    6. OpenAI Codex (ChatGPT Plus/Pro login)");
        console.log("    7. Done");
        const choice = await ask(rl, cyan("    Which provider? "));

        const providerSetup = async (name: string, defaultModel: string, keyName: string) => {
          const existing = providers[name]?.apiKey;
          if (existing) {
            const keep = await ask(rl, cyan(`    ${keyName} already configured. Keep existing? [Y/n] `));
            if (keep.toLowerCase() !== "n") {
              console.log(green(`    Kept existing ${name} config`));
              if (!fallbacks.includes(defaultModel)) fallbacks.push(defaultModel);
              return;
            }
          }
          const key = await ask(rl, cyan(`    ${keyName} API key: `));
          if (key.trim()) {
            const entry: Record<string, string> = { apiKey: key.trim() };
            if (name === "openrouter") entry.baseUrl = "https://openrouter.ai/api/v1";
            else if (name === "opencode") entry.baseUrl = "https://opencode.ai/zen";
            (config.models.providers as Record<string, unknown>)[name] = entry;
            if (!fallbacks.includes(defaultModel)) fallbacks.push(defaultModel);
            console.log(green(`    ${name} configured`));
          }
        };

        switch (choice) {
          case "1": await providerSetup("anthropic", "anthropic/claude-sonnet-4-6", "Anthropic"); break;
          case "2": await providerSetup("openai", "openai/gpt-4o", "OpenAI"); break;
          case "3": await providerSetup("google", "google/gemini-2.0-flash", "Google"); break;
          case "4": {
            await providerSetup("openrouter", "openrouter/anthropic/claude-sonnet-4-6", "OpenRouter");
            // Let user pick a default OpenRouter model
            if (providers.openrouter?.apiKey) {
              const orModel = await ask(rl, cyan("    Default OpenRouter model (e.g., meta-llama/llama-3.1-70b): "));
              if (orModel.trim()) {
                const fullModel = `openrouter/${orModel.trim()}`;
                const idx = fallbacks.indexOf("openrouter/anthropic/claude-sonnet-4-6");
                if (idx >= 0) fallbacks[idx] = fullModel;
                else fallbacks.push(fullModel);
              }
            }
            break;
          }
          case "5": {
            await providerSetup("opencode", "opencode/claude-sonnet-4-6", "OpenCode");
            break;
          }
          case "6": {
            // Codex OAuth — browser-based login
            try {
              const { runOAuthFlow } = await import("../auth/oauth.js");
              const { AuthProfileStore } = await import("../auth/credentials.js");
              console.log(dim("    Launching browser for OpenAI login..."));
              const credential = await runOAuthFlow({
                onUrl: (url) => console.log(dim(`    If browser didn't open: ${url}`)),
                onProgress: (msg) => console.log(dim(`    ${msg}`)),
              });
              const store = new AuthProfileStore();
              await store.setCredential("openai-codex:default", credential);
              if (!fallbacks.includes("codex/codex-mini-latest")) {
                fallbacks.push("codex/codex-mini-latest");
              }
              console.log(green(`    Codex configured (${credential.email})`));
            } catch (err) {
              console.log(yellow(`    Codex OAuth failed: ${err instanceof Error ? err.message : err}`));
            }
            break;
          }
          case "7": case "": picking = false; break;
          default: console.log(dim("    Invalid choice")); break;
        }
      }
      config.agents.defaults.model.fallbacks = fallbacks;
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

    const addWhisper = await ask(rl, cyan("  Set up speech-to-text (voice messages)? [y/N] "));
    if (addWhisper.toLowerCase() === "y") {
      console.log(dim("    1. Groq (recommended — free, fast)"));
      console.log(dim("    2. OpenAI Whisper API (paid, uses OpenAI key)"));
      console.log(dim("    3. Local whisper.cpp (requires manual install)"));
      const whisperChoice = await ask(rl, cyan("    Choice [1]: "));
      if (whisperChoice === "3") {
        config.integrations.whisper = { enabled: true, provider: "local" };
        console.log(green("    Local whisper.cpp configured"));
        console.log(dim("    Make sure whisper is installed and in PATH"));
      } else if (whisperChoice === "2") {
        const existingKey = config.models.providers.openai?.apiKey;
        if (existingKey) {
          config.integrations.whisper = { enabled: true, provider: "openai", apiKey: existingKey };
          console.log(green("    Whisper configured (using existing OpenAI key)"));
        } else {
          const key = await ask(rl, cyan("    OpenAI API key: "));
          if (key.trim()) {
            config.integrations.whisper = { enabled: true, provider: "openai", apiKey: key.trim() };
            console.log(green("    Whisper configured"));
          }
        }
      } else {
        // Groq (default — free)
        console.log(dim("    Get a free API key at: https://console.groq.com/keys"));
        const key = await ask(rl, cyan("    Groq API key: "));
        if (key.trim()) {
          config.integrations.whisper = { enabled: true, provider: "groq" as any, apiKey: key.trim() };
          console.log(green("    Groq Whisper configured (free, fast)"));
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
