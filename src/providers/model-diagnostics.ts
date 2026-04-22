/**
 * Model runtime diagnostics.
 *
 * These helpers describe how Clank will route and present a model without
 * touching provider behavior. They are used by CLI and channel status UIs.
 */

import { parseModelId, type ProviderConfig } from "./router.js";
import { supportsNativeTools } from "./types.js";

export interface ModelRuntimeInfo {
  modelId: string;
  provider: string;
  model: string;
  locality: "local" | "cloud";
  toolMode: string;
  context: string;
  providerStatus: string;
  notes: string[];
}

const LOCAL_PROVIDERS = new Set(["ollama", "lmstudio", "llamacpp", "vllm", "local"]);

const CLOUD_PROVIDERS = new Set([
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "opencode",
  "codex",
]);

export function isLocalProvider(provider: string): boolean {
  return LOCAL_PROVIDERS.has(provider);
}

/**
 * Build a stable, human-readable diagnostic snapshot for a model id.
 */
export function describeModelRuntime(
  modelId: string,
  providers?: ProviderConfig,
): ModelRuntimeInfo {
  const { provider, model } = parseModelId(modelId);
  const locality = isLocalProvider(provider) ? "local" : "cloud";
  const nativeTools = locality === "cloud" || supportsNativeTools(modelId);
  const notes: string[] = [];

  let toolMode: string;
  if (locality === "local") {
    toolMode = nativeTools ? "native tool calls" : "prompt fallback tools";
    if (!nativeTools) {
      notes.push("Tool calls are injected into the prompt because this model name is not marked native-tool-capable.");
    }
  } else {
    toolMode = "provider tool calls";
  }

  let context = locality === "local"
    ? "32K default; Ollama models auto-detect from /api/show when connected"
    : "provider default";
  if (provider === "anthropic") context = "200K provider window";
  if (provider === "openai" || provider === "codex") context = "128K for current GPT/Codex models, provider-dependent";
  if (provider === "google") context = "provider-dependent Gemini window";

  const providerCfg = providers?.[provider];
  let providerStatus = "not configured";
  if (provider === "ollama") {
    providerStatus = providerCfg?.baseUrl ? `configured at ${providerCfg.baseUrl}` : "default http://127.0.0.1:11434";
  } else if (locality === "local") {
    providerStatus = providerCfg?.baseUrl ? `configured at ${providerCfg.baseUrl}` : "default local endpoint";
  } else if (providerCfg?.apiKey) {
    providerStatus = "API key configured";
  } else if (CLOUD_PROVIDERS.has(provider)) {
    providerStatus = "API key required";
  }

  return {
    modelId,
    provider,
    model,
    locality,
    toolMode,
    context,
    providerStatus,
    notes,
  };
}

export function formatModelRuntimeLines(info: ModelRuntimeInfo, indent = "  "): string[] {
  const lines = [
    `${indent}Provider: ${info.provider} (${info.locality})`,
    `${indent}Model: ${info.model}`,
    `${indent}Tools: ${info.toolMode}`,
    `${indent}Context: ${info.context}`,
    `${indent}Status: ${info.providerStatus}`,
  ];

  for (const note of info.notes) {
    lines.push(`${indent}Note: ${note}`);
  }

  return lines;
}

