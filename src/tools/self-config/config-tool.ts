/**
 * Config tool — lets the agent read and modify gateway config.
 *
 * This is the foundation of self-configuration. Instead of manually
 * editing config.json5, users just tell their agent what they want
 * and the agent uses this tool to make it happen.
 */

import { loadConfig, saveConfig, getConfigPath } from "../../config/index.js";
import type { Tool, ToolContext, ValidationResult } from "../types.js";

export const configTool: Tool = {
  definition: {
    name: "config",
    description:
      "Read or modify the Clank gateway configuration. Use 'read' to see current config, " +
      "'set' to change a value, or 'get' to read a specific key. " +
      "Keys use dot notation: 'gateway.port', 'agents.defaults.model.primary', etc.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "'read' (full config), 'get' (specific key), or 'set' (change a value)",
        },
        key: { type: "string", description: "Config key in dot notation (for get/set)" },
        value: { type: "string", description: "New value to set (for set action). JSON parsed if possible." },
      },
      required: ["action"],
    },
  },

  safetyLevel: (args) => (args.action === "read" || args.action === "get") ? "low" : "medium",
  readOnly: false,

  validate(args: Record<string, unknown>): ValidationResult {
    const action = args.action as string;
    if (!["read", "get", "set"].includes(action)) {
      return { ok: false, error: "action must be 'read', 'get', or 'set'" };
    }
    if ((action === "get" || action === "set") && !args.key) {
      return { ok: false, error: "key is required for get/set" };
    }
    if (action === "set" && args.value === undefined) {
      return { ok: false, error: "value is required for set" };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;
    const config = await loadConfig();

    if (action === "read") {
      return JSON.stringify(config, null, 2);
    }

    const key = args.key as string;
    const keys = key.split(".");

    if (action === "get") {
      let current: unknown = config;
      for (const k of keys) {
        if (current && typeof current === "object") {
          current = (current as Record<string, unknown>)[k];
        } else {
          return `Key not found: ${key}`;
        }
      }
      return typeof current === "object" ? JSON.stringify(current, null, 2) : String(current);
    }

    if (action === "set") {
      let parsed: unknown = args.value;
      try {
        parsed = JSON.parse(args.value as string);
      } catch {
        // Keep as string
      }

      // Navigate to parent and set the value
      let current: Record<string, unknown> = config as unknown as Record<string, unknown>;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!current[keys[i]] || typeof current[keys[i]] !== "object") {
          current[keys[i]] = {};
        }
        current = current[keys[i]] as Record<string, unknown>;
      }
      current[keys[keys.length - 1]] = parsed;

      await saveConfig(config);
      return `Set ${key} = ${JSON.stringify(parsed)}`;
    }

    return "Unknown action";
  },

  formatConfirmation(args: Record<string, unknown>): string {
    if (args.action === "set") return `Set config: ${args.key} = ${args.value}`;
    return `Read config`;
  },
};
