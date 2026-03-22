/**
 * Agent tool — add, configure, and manage agents through conversation.
 *
 * "Create a new agent called Ratchet that uses Qwen 3.5 for coding"
 * → agent uses this tool to add the definition and routing.
 */

import { loadConfig, saveConfig } from "../../config/index.js";
import type { Tool, ValidationResult } from "../types.js";

export const agentTool: Tool = {
  definition: {
    name: "manage_agent",
    description:
      "Add, remove, list, or configure agents. Agents are named AI instances " +
      "with their own model, workspace, and tool access. " +
      "Use 'list' to see agents, 'add' to create one, 'remove' to delete, 'configure' to update.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "'list', 'add', 'remove', or 'configure'" },
        id: { type: "string", description: "Agent ID (lowercase, no spaces)" },
        name: { type: "string", description: "Display name for the agent" },
        model: { type: "string", description: "Model ID (e.g., 'ollama/qwen3.5')" },
        workspace: { type: "string", description: "Workspace directory path" },
        toolTier: { type: "string", description: "'full', 'core', or 'auto'" },
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
    if (action !== "list" && !args.id) {
      return { ok: false, error: "id is required" };
    }
    if (action === "add" && !args.model) {
      return { ok: false, error: "model is required when adding an agent" };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const config = await loadConfig();
    const action = args.action as string;

    if (action === "list") {
      const agents = config.agents.list || [];
      if (agents.length === 0) return "No agents configured (using default agent)";
      return agents.map((a) =>
        `${a.id}: ${a.name || a.id} | model: ${a.model?.primary || "default"} | workspace: ${a.workspace || "default"}`
      ).join("\n");
    }

    const id = args.id as string;

    if (action === "add") {
      const existing = config.agents.list.find((a) => a.id === id);
      if (existing) return `Agent ${id} already exists. Use 'configure' to update.`;

      config.agents.list.push({
        id,
        name: (args.name as string) || id,
        model: { primary: args.model as string },
        workspace: args.workspace as string | undefined,
        toolTier: (args.toolTier as "full" | "core" | "auto") || undefined,
      });

      await saveConfig(config);
      return `Agent ${id} created with model ${args.model}`;
    }

    if (action === "remove") {
      const idx = config.agents.list.findIndex((a) => a.id === id);
      if (idx === -1) return `Agent ${id} not found`;
      config.agents.list.splice(idx, 1);
      await saveConfig(config);
      return `Agent ${id} removed`;
    }

    if (action === "configure") {
      const agent = config.agents.list.find((a) => a.id === id);
      if (!agent) return `Agent ${id} not found`;
      if (args.name) agent.name = args.name as string;
      if (args.model) agent.model = { primary: args.model as string };
      if (args.workspace) agent.workspace = args.workspace as string;
      if (args.toolTier) agent.toolTier = args.toolTier as "full" | "core" | "auto";
      await saveConfig(config);
      return `Agent ${id} updated`;
    }

    return "Unknown action";
  },

  formatConfirmation(args: Record<string, unknown>): string {
    return `${args.action} agent: ${args.id || "all"}`;
  },
};
