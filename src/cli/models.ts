/**
 * CLI model management commands.
 */

import { loadConfig, saveConfig, ensureConfigDir } from "../config/index.js";
import { detectLocalServers } from "../providers/index.js";
import { describeModelRuntime, formatModelRuntimeLines } from "../providers/index.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export async function modelsList(): Promise<void> {
  const config = await loadConfig();
  console.log("");
  console.log(`  Default: ${config.agents.defaults.model.primary}`);
  const defaultRuntime = describeModelRuntime(config.agents.defaults.model.primary, config.models.providers);
  for (const line of formatModelRuntimeLines(defaultRuntime, "    ")) {
    console.log(dim(line));
  }
  if (config.agents.defaults.model.fallbacks?.length) {
    console.log(`  Fallbacks: ${config.agents.defaults.model.fallbacks.join(", ")}`);
    for (const fallback of config.agents.defaults.model.fallbacks) {
      const runtime = describeModelRuntime(fallback, config.models.providers);
      console.log(dim(`    - ${fallback}: ${runtime.locality}, ${runtime.toolMode}, ${runtime.providerStatus}`));
    }
  }
  console.log("");
  console.log(dim("  Configured providers:"));
  for (const [name, cfg] of Object.entries(config.models.providers)) {
    const c = cfg as Record<string, unknown>;
    const status = c.apiKey ? green("key set") : c.baseUrl ? green("configured") : dim("not configured");
    console.log(`    ${name}: ${status}`);
  }

  console.log("");
  console.log(dim("  Detecting local servers..."));
  const servers = await detectLocalServers();
  if (servers.length > 0) {
    for (const s of servers) {
      console.log(green(`    ${s.provider} at ${s.baseUrl} — ${s.models.length} models`));
      for (const m of s.models.slice(0, 5)) {
        console.log(dim(`      ${m}`));
      }
      if (s.models.length > 5) console.log(dim(`      ... and ${s.models.length - 5} more`));
    }
  } else {
    console.log(dim("    No local servers found"));
  }
  console.log("");
}

export async function modelsAdd(): Promise<void> {
  const { createInterface } = await import("node:readline");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((r) => rl.question(q, r));

  try {
    await ensureConfigDir();
    const config = await loadConfig();

    console.log("");
    console.log("  Add a model provider:");
    console.log(dim("    1. Anthropic (Claude)"));
    console.log(dim("    2. OpenAI (GPT)"));
    console.log(dim("    3. Google (Gemini)"));
    console.log(dim("    4. Brave Search (web search)"));
    console.log("");

    const choice = await ask(cyan("  Choice: "));

    switch (choice) {
      case "1": {
        const key = await ask(cyan("  Anthropic API key: "));
        if (key.trim()) {
          config.models.providers.anthropic = { apiKey: key.trim() };
          await saveConfig(config);
          console.log(green("  Anthropic added"));
        }
        break;
      }
      case "2": {
        const key = await ask(cyan("  OpenAI API key: "));
        if (key.trim()) {
          config.models.providers.openai = { apiKey: key.trim() };
          await saveConfig(config);
          console.log(green("  OpenAI added"));
        }
        break;
      }
      case "3": {
        const key = await ask(cyan("  Google AI API key: "));
        if (key.trim()) {
          config.models.providers.google = { apiKey: key.trim() };
          await saveConfig(config);
          console.log(green("  Google added"));
        }
        break;
      }
      case "4": {
        const key = await ask(cyan("  Brave Search API key: "));
        if (key.trim()) {
          config.tools.webSearch = { enabled: true, provider: "brave", apiKey: key.trim() };
          await saveConfig(config);
          console.log(green("  Brave Search added"));
        }
        break;
      }
      default:
        console.log(dim("  Cancelled"));
    }
    console.log("");
  } finally {
    rl.close();
  }
}

export async function modelsTest(): Promise<void> {
  const config = await loadConfig();
  const modelId = config.agents.defaults.model.primary;
  console.log("");
  console.log(dim(`  Testing ${modelId}...`));

  try {
    const { resolveWithFallback } = await import("../providers/index.js");
    const resolved = await resolveWithFallback(
      modelId,
      config.agents.defaults.model.fallbacks || [],
      config.models.providers,
    );
    console.log(green(`  Connected to ${resolved.modelId} (${resolved.isLocal ? "local" : "cloud"})`));
  } catch (err) {
    console.log(`  \x1b[31mFailed: ${err instanceof Error ? err.message : err}\x1b[0m`);
  }
  console.log("");
}
