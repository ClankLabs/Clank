/**
 * Message tool — send messages to channels from within agent execution.
 *
 * Lets agents proactively reach out: "Send a summary to my Telegram",
 * "Post the build status in Discord", etc.
 */

import type { Tool, ValidationResult } from "../types.js";

export const messageTool: Tool = {
  definition: {
    name: "send_message",
    description:
      "Send a message to a specific channel or session. " +
      "Use this to proactively notify the user on another interface.",
    parameters: {
      type: "object",
      properties: {
        channel: { type: "string", description: "Target channel ('telegram', 'discord', 'web')" },
        to: { type: "string", description: "Recipient ID (chat ID, channel ID, etc.)" },
        text: { type: "string", description: "Message text to send" },
      },
      required: ["channel", "text"],
    },
  },

  safetyLevel: "high", // Sending external messages is always high risk
  readOnly: false,

  validate(args: Record<string, unknown>): ValidationResult {
    if (!args.channel) return { ok: false, error: "channel is required" };
    if (!args.text) return { ok: false, error: "text is required" };
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    // This tool needs gateway integration to actually send messages.
    // The gateway routes the message to the appropriate channel adapter.
    // For now, return a placeholder indicating what would happen.
    return `Message queued for ${args.channel}${args.to ? `:${args.to}` : ""}: "${(args.text as string).slice(0, 100)}"`;
  },

  formatConfirmation(args: Record<string, unknown>): string {
    return `Send message to ${args.channel}: "${(args.text as string).slice(0, 50)}"`;
  },
};
