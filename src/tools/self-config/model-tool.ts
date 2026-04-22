/**
 * Model tool — manage models and providers through conversation.
 */

import { loadConfig, saveConfig } from "../../config/index.js";
import { detectLocalServers, describeModelRuntime, formatModelRuntimeLines } from "../../providers/index.js";
import type { Tool, ValidationResult } from "../types.js";

export const modelTool: Tool = {
  definition: {
    name: "manage_model",
    description:
      "List available models, detect local servers, add providers, or switch the default model. " +
      "Use 'detect' to scan for local model servers, 'list' to see configured models, " +
      "'set-default' to change the primary model, 'add-provider' to add a cloud provider.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "'list', 'detect', 'set-default', or 'add-provider'" },
        model: { type: "string", description: "Model ID for set-default (e.g., 'ollama/qwen3.5')" },
        provider: { type: "string", description: "Provider name for add-provider ('anthropic', 'openai', 'google', 'openrouter', 'opencode')" },
        apiKey: { type: "string", description: "API key for add-provider" },
      },
      required: ["action"],
    },
  },

  safetyLevel: (args) => (args.action === "list" || args.action === "detect") ? "low" : "medium",
  readOnly: false,

  validate(args: Record<string, unknown>): ValidationResult {
    const action = args.action as string;
    if (!["list", "detect", "set-default", "add-provider"].includes(action)) {
      return { ok: false, error: "Invalid action" };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const config = await loadConfig();
    const action = args.action as string;

    if (action === "detect") {
      const servers = await detectLocalServers();
      if (servers.length === 0) return "No local model servers detected.";
      return servers.map((s) =>
        `${s.provider} at ${s.baseUrl}\n  Models: ${s.models.slice(0, 10).join(", ")}`
      ).join("\n\n");
    }

    if (action === "list") {
      const lines: string[] = [];
      lines.push(`Default: ${config.agents.defaults.model.primary}`);
      lines.push(...formatModelRuntimeLines(
        describeModelRuntime(config.agents.defaults.model.primary, config.models.providers),
        "  ",
      ));
      if (config.agents.defaults.model.fallbacks?.length) {
        lines.push(`Fallbacks: ${config.agents.defaults.model.fallbacks.join(", ")}`);
      }
      lines.push("\nProviders:");
      for (const [name, cfg] of Object.entries(config.models.providers)) {
        const c = cfg as Record<string, unknown>;
        lines.push(`  ${name}: ${c.baseUrl || c.apiKey ? "configured" : "not configured"}`);
      }
      return lines.join("\n");
    }

    if (action === "set-default") {
      if (!args.model) return "Error: model is required";
      config.agents.defaults.model.primary = args.model as string;
      await saveConfig(config);
      return `Default model switched to ${args.model}. The change takes effect on the next message.`;
    }

    if (action === "add-provider") {
      if (!args.provider || !args.apiKey) return "Error: provider and apiKey are required";
      const provider = args.provider as string;
      const entry: Record<string, string> = { apiKey: args.apiKey as string };
      // OpenRouter needs a baseUrl since it's an OpenAI-compatible cloud API
      if (provider === "openrouter") {
        entry.baseUrl = "https://openrouter.ai/api/v1";
      } else if (provider === "opencode") {
        entry.baseUrl = "https://opencode.ai/zen";
      }
      (config.models.providers as Record<string, unknown>)[provider] = entry;
      await saveConfig(config);
      return `Provider ${provider} added with API key`;
    }

    return "Unknown action";
  },

  formatConfirmation(args: Record<string, unknown>): string {
    return `${args.action} model configuration`;
  },
};
