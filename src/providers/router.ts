/**
 * Provider router — resolves model identifiers to provider instances.
 *
 * Model identifiers use the format "provider/model", e.g.:
 *   - "ollama/qwen3.5"
 *   - "anthropic/claude-sonnet-4-6"
 *   - "openai/gpt-4o"
 *
 * The router also handles the fallback chain: if the primary model fails,
 * it tries fallbacks in order. This is how local-first works in practice —
 * try Ollama first, fall back to cloud if needed.
 */

import { type BaseProvider, type ResolvedProvider } from "./types.js";
import { OllamaProvider } from "./ollama.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GoogleProvider } from "./google.js";

export interface ProviderConfig {
  ollama?: {
    baseUrl?: string;
  };
  anthropic?: {
    apiKey: string;
    baseUrl?: string;
  };
  openai?: {
    apiKey: string;
    baseUrl?: string;
  };
  google?: {
    apiKey: string;
    baseUrl?: string;
  };
  /** Local OpenAI-compatible servers (llamacpp, lmstudio, vllm, etc.) */
  [key: string]: { baseUrl?: string; apiKey?: string } | undefined;
}

/**
 * Parse a model identifier like "ollama/qwen3.5" into provider + model.
 */
export function parseModelId(modelId: string): { provider: string; model: string } {
  const slash = modelId.indexOf("/");
  if (slash === -1) {
    // No provider prefix — assume ollama for local-first
    return { provider: "ollama", model: modelId };
  }
  return {
    provider: modelId.slice(0, slash),
    model: modelId.slice(slash + 1),
  };
}

/**
 * Create a provider instance for a model identifier.
 */
export function createProvider(
  modelId: string,
  config: ProviderConfig,
  opts?: { maxResponseTokens?: number },
): ResolvedProvider {
  const { provider, model } = parseModelId(modelId);

  switch (provider) {
    case "ollama": {
      const p = new OllamaProvider({
        baseUrl: config.ollama?.baseUrl,
        model,
        maxResponseTokens: opts?.maxResponseTokens,
      });
      return { provider: p, providerName: "ollama", modelId, isLocal: true };
    }

    case "anthropic": {
      if (!config.anthropic?.apiKey) {
        throw new Error(`Anthropic API key required for model ${modelId}`);
      }
      const p = new AnthropicProvider({
        apiKey: config.anthropic.apiKey,
        model,
        baseUrl: config.anthropic.baseUrl,
      });
      return { provider: p, providerName: "anthropic", modelId, isLocal: false };
    }

    case "openai": {
      if (!config.openai?.apiKey) {
        throw new Error(`OpenAI API key required for model ${modelId}`);
      }
      const p = new OpenAIProvider({
        apiKey: config.openai.apiKey,
        model,
        baseUrl: config.openai.baseUrl,
        maxResponseTokens: opts?.maxResponseTokens,
      });
      return { provider: p, providerName: "openai", modelId, isLocal: false };
    }

    case "google": {
      if (!config.google?.apiKey) {
        throw new Error(`Google API key required for model ${modelId}`);
      }
      const p = new GoogleProvider({ apiKey: config.google.apiKey, model });
      return { provider: p, providerName: "google", modelId, isLocal: false };
    }

    case "openrouter": {
      // OpenRouter — access many models through one API key.
      // OpenAI-compatible API at https://openrouter.ai/api/v1
      // Model format: openrouter/anthropic/claude-sonnet-4-6
      const orConfig = config.openrouter ?? config["openrouter"];
      if (!orConfig?.apiKey) {
        throw new Error(`OpenRouter API key required for model ${modelId}`);
      }
      const p = new OpenAIProvider({
        apiKey: orConfig.apiKey,
        baseUrl: orConfig.baseUrl || "https://openrouter.ai/api/v1",
        model,
        maxResponseTokens: opts?.maxResponseTokens,
      });
      return { provider: p, providerName: "openrouter", modelId, isLocal: false };
    }

    case "codex": {
      // OpenAI Codex — uses ChatGPT Plus/Pro subscription via OAuth.
      // The access token is resolved by the gateway before provider creation
      // and injected into config.codex.apiKey at runtime.
      const codexConfig = config.codex ?? config["codex"];
      if (!codexConfig?.apiKey) {
        throw new Error(
          `Codex OAuth not configured. Run 'clank auth login' to sign in with your OpenAI account.`,
        );
      }
      const p = new OpenAIProvider({
        apiKey: codexConfig.apiKey,
        baseUrl: "https://api.openai.com",
        model,
        maxResponseTokens: opts?.maxResponseTokens,
      });
      return { provider: p, providerName: "codex", modelId, isLocal: false };
    }

    case "opencode": {
      // OpenCode — subscription-based API with many models.
      // OpenAI-compatible API at https://opencode.ai/zen
      const ocConfig = config.opencode ?? config["opencode"];
      if (!ocConfig?.apiKey) {
        throw new Error(`OpenCode API key required for model ${modelId}`);
      }
      const p = new OpenAIProvider({
        apiKey: ocConfig.apiKey,
        baseUrl: ocConfig.baseUrl || "https://opencode.ai/zen",
        model,
        maxResponseTokens: opts?.maxResponseTokens,
      });
      return { provider: p, providerName: "opencode", modelId, isLocal: false };
    }

    case "lmstudio":
    case "llamacpp":
    case "vllm":
    case "local": {
      // These are all OpenAI-compatible local servers
      const defaultUrls: Record<string, string> = {
        lmstudio: "http://127.0.0.1:1234",
        llamacpp: "http://127.0.0.1:8080",
        vllm: "http://127.0.0.1:8000",
        local: "http://127.0.0.1:8080",
      };
      // Read base URL from config (e.g., config.llamacpp.baseUrl)
      const providerCfg = config[provider];
      const baseUrl = providerCfg?.baseUrl || defaultUrls[provider] || defaultUrls.local;
      const p = new OpenAIProvider({
        baseUrl,
        model,
        isLocal: true,
        maxResponseTokens: opts?.maxResponseTokens,
      });
      return { provider: p, providerName: provider, modelId, isLocal: true };
    }

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Resolve a model with fallback chain.
 *
 * Tries the primary model first, then fallbacks in order.
 * Returns the first provider that can be created successfully.
 * For Ollama, also checks if the server is reachable.
 */
export async function resolveWithFallback(
  primary: string,
  fallbacks: string[],
  config: ProviderConfig,
  opts?: { maxResponseTokens?: number },
): Promise<ResolvedProvider> {
  const chain = [primary, ...fallbacks];

  for (const modelId of chain) {
    try {
      const resolved = createProvider(modelId, config, opts);

      // For local providers, verify the server is reachable
      if (resolved.isLocal && resolved.providerName === "ollama") {
        const models = await OllamaProvider.detect(config.ollama?.baseUrl);
        if (!models) {
          continue; // Ollama not running, try next
        }
      }

      return resolved;
    } catch {
      // This provider can't be created (e.g., missing API key), try next
      continue;
    }
  }

  throw new Error(
    `No available provider. Tried: ${chain.join(", ")}. ` +
    `Check that your model server is running or API keys are configured.`,
  );
}

/**
 * Auto-detect available local model servers.
 * Returns a list of detected servers with their models.
 */
export async function detectLocalServers(): Promise<
  Array<{ provider: string; baseUrl: string; models: string[] }>
> {
  const servers: Array<{ provider: string; baseUrl: string; models: string[] }> = [];

  // Check Ollama
  const ollamaModels = await OllamaProvider.detect();
  if (ollamaModels) {
    servers.push({
      provider: "ollama",
      baseUrl: "http://127.0.0.1:11434",
      models: ollamaModels,
    });
  }

  // Check LM Studio
  const lmStudioModels = await OpenAIProvider.detect("http://127.0.0.1:1234");
  if (lmStudioModels) {
    servers.push({
      provider: "lmstudio",
      baseUrl: "http://127.0.0.1:1234",
      models: lmStudioModels,
    });
  }

  // Check llama.cpp (common ports)
  for (const port of [8080, 14438]) {
    const llamaCppModels = await OpenAIProvider.detect(`http://127.0.0.1:${port}`);
    if (llamaCppModels) {
      servers.push({
        provider: "llamacpp",
        baseUrl: `http://127.0.0.1:${port}`,
        models: llamaCppModels,
      });
      break; // Found one, stop checking
    }
  }

  // Check vLLM
  const vllmModels = await OpenAIProvider.detect("http://127.0.0.1:8000");
  if (vllmModels) {
    servers.push({
      provider: "vllm",
      baseUrl: "http://127.0.0.1:8000",
      models: vllmModels,
    });
  }

  return servers;
}
