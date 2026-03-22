/**
 * Channel tool — add, remove, and configure channels through conversation.
 *
 * "Hey, connect my Telegram bot" → agent uses this tool to add
 * the Telegram config, enable the adapter, and restart it.
 */

import { loadConfig, saveConfig } from "../../config/index.js";
import type { Tool, ToolContext, ValidationResult } from "../types.js";

export const channelTool: Tool = {
  definition: {
    name: "manage_channel",
    description:
      "Add, remove, or configure a messaging channel (Telegram, Discord, Slack, etc.). " +
      "Use 'list' to see configured channels, 'add' to set one up, 'remove' to disable, " +
      "'configure' to change settings.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "'list', 'add', 'remove', or 'configure'" },
        channel: { type: "string", description: "Channel name: 'telegram', 'discord', 'slack', 'web'" },
        settings: { type: "string", description: "JSON settings to apply (for add/configure)" },
      },
      required: ["action"],
    },
  },

  safetyLevel: (args) => args.action === "list" ? "low" : "medium",
  readOnly: false,

  validate(args: Record<string, unknown>): ValidationResult {
    const action = args.action as string;
    if (!["list", "add", "remove", "configure"].includes(action)) {
      return { ok: false, error: "action must be 'list', 'add', 'remove', or 'configure'" };
    }
    if (action !== "list" && !args.channel) {
      return { ok: false, error: "channel is required for add/remove/configure" };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const config = await loadConfig();
    const action = args.action as string;

    if (action === "list") {
      const channels = config.channels || {};
      const entries = Object.entries(channels).map(([name, cfg]) => {
        const c = cfg as Record<string, unknown>;
        return `${name}: ${c.enabled ? "enabled" : "disabled"}`;
      });
      return entries.length > 0 ? entries.join("\n") : "No channels configured";
    }

    const channel = args.channel as string;

    if (action === "add" || action === "configure") {
      let settings: Record<string, unknown> = {};
      if (args.settings) {
        try {
          settings = JSON.parse(args.settings as string) as Record<string, unknown>;
        } catch {
          return "Error: settings must be valid JSON";
        }
      }

      if (!config.channels) config.channels = {};
      const existing = (config.channels as Record<string, unknown>)[channel] as Record<string, unknown> || {};
      (config.channels as Record<string, unknown>)[channel] = { ...existing, ...settings, enabled: true };

      await saveConfig(config);
      return `Channel ${channel} ${action === "add" ? "added" : "updated"} and enabled`;
    }

    if (action === "remove") {
      if (config.channels && (config.channels as Record<string, unknown>)[channel]) {
        ((config.channels as Record<string, unknown>)[channel] as Record<string, unknown>).enabled = false;
        await saveConfig(config);
        return `Channel ${channel} disabled`;
      }
      return `Channel ${channel} not found`;
    }

    return "Unknown action";
  },

  formatConfirmation(args: Record<string, unknown>): string {
    return `${args.action} channel: ${args.channel || "all"}`;
  },
};
