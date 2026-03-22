/**
 * Session tool — list, manage, and spawn sessions through conversation.
 */

import { join } from "node:path";
import { getConfigDir } from "../../config/index.js";
import { SessionStore } from "../../sessions/index.js";
import type { Tool, ValidationResult } from "../types.js";

export const sessionTool: Tool = {
  definition: {
    name: "manage_session",
    description:
      "List, inspect, reset, or delete chat sessions. " +
      "Use 'list' to see all sessions, 'reset' to clear a session's history, " +
      "'delete' to remove a session entirely.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "'list', 'reset', or 'delete'" },
        sessionKey: { type: "string", description: "Session key (for reset/delete)" },
      },
      required: ["action"],
    },
  },

  safetyLevel: (args) => args.action === "list" ? "low" : "medium",
  readOnly: false,

  validate(args: Record<string, unknown>): ValidationResult {
    const action = args.action as string;
    if (!["list", "reset", "delete"].includes(action)) {
      return { ok: false, error: "action must be 'list', 'reset', or 'delete'" };
    }
    if (action !== "list" && !args.sessionKey) {
      return { ok: false, error: "sessionKey is required" };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const store = new SessionStore(join(getConfigDir(), "conversations"));
    await store.init();

    const action = args.action as string;

    if (action === "list") {
      const sessions = store.list();
      if (sessions.length === 0) return "No sessions";
      return sessions.map((s) =>
        `${s.normalizedKey} | ${s.label || "(untitled)"} | agent: ${s.agentId || "default"} | ${new Date(s.updatedAt).toLocaleString()}`
      ).join("\n");
    }

    const key = args.sessionKey as string;

    if (action === "reset") {
      const result = await store.reset(key);
      return result ? `Session ${key} reset` : `Session ${key} not found`;
    }

    if (action === "delete") {
      const result = await store.delete(key);
      return result ? `Session ${key} deleted` : `Session ${key} not found`;
    }

    return "Unknown action";
  },

  formatConfirmation(args: Record<string, unknown>): string {
    return `${args.action} session: ${args.sessionKey || "all"}`;
  },
};
