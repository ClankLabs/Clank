/**
 * Configuration system for Clank.
 *
 * Config lives at ~/.clank/config.json5 (or %APPDATA%/Clank/config.json5 on Windows).
 * Uses JSON5 for human-friendly comments and trailing commas.
 * Supports ${ENV_VAR} substitution for secrets.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";
import JSON5 from "json5";
import type { ProviderConfig } from "../providers/router.js";
import type { ToolTier } from "../tools/types.js";
import type { ModelConfig } from "../providers/types.js";

/** Full Clank configuration schema */
export interface ClankConfig {
  /** Gateway settings */
  gateway: {
    port: number;
    bind: "loopback" | "lan" | string;
    auth: {
      mode: "token" | "pin" | "none";
      token?: string;
    };
  };

  /** Agent definitions */
  agents: {
    defaults: {
      model: ModelConfig;
      workspace: string;
      toolTier: ToolTier;
      temperature?: number;
      maxResponseTokens?: number;
      /** Compact system prompt for small models — strips SOUL.md fluff */
      compactPrompt?: boolean;
      /** Control thinking/reasoning output: "on", "off", or "auto" */
      thinking?: "on" | "off" | "auto";
      /** Timeout for model responses in ms (default: 120000) */
      responseTimeout?: number;
    };
    list: Array<{
      id: string;
      name?: string;
      model?: ModelConfig;
      workspace?: string;
      toolTier?: ToolTier;
      tools?: { allow?: string[]; deny?: string[] };
      compactPrompt?: boolean;
      thinking?: "on" | "off" | "auto";
      voiceId?: string; // ElevenLabs voice for this agent
    }>;
  };

  /** Model provider configs */
  models: {
    providers: ProviderConfig;
  };

  /** Channel configs */
  channels: {
    telegram?: {
      enabled: boolean;
      botToken?: string;
      allowFrom?: Array<string | number>;
      groups?: Record<string, { requireMention?: boolean }>;
    };
    discord?: {
      enabled: boolean;
      botToken?: string;
    };
    web?: {
      enabled: boolean;
    };
  };

  /** Session settings */
  session: {
    dmScope: "main" | "per-peer" | "per-channel-peer";
    maxSessions: number;
    resetMode?: "idle" | "daily";
    resetAfterMinutes?: number;
  };

  /** Tool settings */
  tools: {
    autoApprove: { low: boolean; medium: boolean; high: boolean };
    webSearch?: { enabled: boolean; provider?: string; apiKey?: string };
  };

  /** Safety settings */
  safety: {
    confirmExternal: boolean;
  };

  /** Third-party API integrations */
  integrations: {
    elevenlabs?: {
      enabled: boolean;
      apiKey: string;
      voiceId?: string;
      model?: string; // e.g., "eleven_multilingual_v2"
    };
    whisper?: {
      enabled: boolean;
      provider: "groq" | "openai" | "local"; // groq = free, openai = paid, local = whisper.cpp
      apiKey?: string; // for groq or openai
      model?: string;
    };
    imageGen?: {
      enabled: boolean;
      provider: "openai" | "fal";
      apiKey?: string;
    };
    /** Generic integrations — extensible for future services */
    [key: string]: { enabled: boolean; apiKey?: string; [k: string]: unknown } | undefined;
  };
}

/** Get the config directory path */
export function getConfigDir(): string {
  if (platform() === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Clank");
  }
  return join(homedir(), ".clank");
}

/** Get the config file path */
export function getConfigPath(): string {
  return join(getConfigDir(), "config.json5");
}

/** Default configuration */
export function defaultConfig(): ClankConfig {
  return {
    gateway: {
      port: 18790,
      bind: "loopback",
      auth: { mode: "token" },
    },
    agents: {
      defaults: {
        model: { primary: "ollama/qwen3.5" },
        workspace: join(getConfigDir(), "workspace"),
        toolTier: "auto",
        temperature: 0.7,
      },
      list: [],
    },
    models: {
      providers: {
        ollama: { baseUrl: "http://127.0.0.1:11434" },
      },
    },
    channels: {
      web: { enabled: true },
    },
    session: {
      dmScope: "main",
      maxSessions: 50,
    },
    tools: {
      autoApprove: { low: true, medium: false, high: false },
    },
    safety: {
      confirmExternal: true,
    },
    integrations: {},
  };
}

/**
 * Substitute ${ENV_VAR} references in string values.
 * This lets users reference secrets from environment variables
 * instead of storing them in the config file.
 */
function substituteEnvVars(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(/\$\{(\w+)\}/g, (_, varName) => {
      return process.env[varName] || "";
    });
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVars);
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = substituteEnvVars(value);
    }
    return result;
  }
  return obj;
}

/** Deep merge two objects (source overrides target) */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === "object" && !Array.isArray(value) && target[key] && typeof target[key] === "object") {
      result[key] = deepMerge(target[key] as Record<string, unknown>, value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Load configuration from disk, merging with defaults */
export async function loadConfig(): Promise<ClankConfig> {
  const configPath = getConfigPath();
  const defaults = defaultConfig();

  if (!existsSync(configPath)) {
    return defaults;
  }

  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON5.parse(raw) as Record<string, unknown>;
    const substituted = substituteEnvVars(parsed) as Record<string, unknown>;
    return deepMerge(defaults as unknown as Record<string, unknown>, substituted) as unknown as ClankConfig;
  } catch (err) {
    console.error(`Warning: Failed to parse config at ${configPath}, using defaults`);
    return defaults;
  }
}

/** Save configuration to disk */
export async function saveConfig(config: ClankConfig): Promise<void> {
  const configPath = getConfigPath();
  await mkdir(getConfigDir(), { recursive: true });

  // JSON5 stringify with nice formatting
  const content = JSON5.stringify(config, null, 2);
  await writeFile(configPath, content, "utf-8");
}

/** Ensure the config directory and workspace exist */
export async function ensureConfigDir(): Promise<void> {
  const configDir = getConfigDir();
  await mkdir(configDir, { recursive: true });
  await mkdir(join(configDir, "workspace"), { recursive: true });
  await mkdir(join(configDir, "conversations"), { recursive: true });
  await mkdir(join(configDir, "memory"), { recursive: true });
  await mkdir(join(configDir, "logs"), { recursive: true });
}
