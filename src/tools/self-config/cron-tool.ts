/**
 * Cron tool — manage scheduled tasks through conversation.
 *
 * "Check my email every hour" → agent creates a cron job.
 */

import { join } from "node:path";
import { getConfigDir } from "../../config/index.js";
import { CronScheduler } from "../../cron/index.js";
import type { Tool, ValidationResult } from "../types.js";

export const cronTool: Tool = {
  definition: {
    name: "manage_cron",
    description:
      "Create, list, enable, disable, or remove scheduled tasks. " +
      "Schedules use simple formats: '30s', '5m', '1h', '24h', 'daily'.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "'list', 'add', 'remove', 'enable', or 'disable'" },
        name: { type: "string", description: "Job name (for add)" },
        schedule: { type: "string", description: "Schedule expression (for add)" },
        prompt: { type: "string", description: "What the agent should do (for add)" },
        agentId: { type: "string", description: "Agent to run the job (default: current)" },
        jobId: { type: "string", description: "Job ID (for remove/enable/disable)" },
      },
      required: ["action"],
    },
  },

  safetyLevel: (args) => args.action === "list" ? "low" : "medium",
  readOnly: false,

  validate(args: Record<string, unknown>): ValidationResult {
    const action = args.action as string;
    if (!["list", "add", "remove", "enable", "disable"].includes(action)) {
      return { ok: false, error: "Invalid action" };
    }
    if (action === "add" && (!args.name || !args.schedule || !args.prompt)) {
      return { ok: false, error: "name, schedule, and prompt are required for add" };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>, ctx): Promise<string> {
    const scheduler = new CronScheduler(join(getConfigDir(), "cron"));
    await scheduler.init();

    const action = args.action as string;

    if (action === "list") {
      const jobs = scheduler.listJobs();
      if (jobs.length === 0) return "No scheduled jobs";
      return jobs.map((j) =>
        `${j.id.slice(0, 8)} | ${j.name} | ${j.schedule} | ${j.enabled ? "enabled" : "disabled"} | agent: ${j.agentId}`
      ).join("\n");
    }

    if (action === "add") {
      const job = await scheduler.addJob({
        name: args.name as string,
        schedule: args.schedule as string,
        agentId: (args.agentId as string) || ctx.agentId || "default",
        prompt: args.prompt as string,
      });
      return `Job created: ${job.id.slice(0, 8)} — "${job.name}" runs every ${job.schedule}`;
    }

    if (action === "remove") {
      if (!args.jobId) return "Error: jobId is required";
      const removed = await scheduler.removeJob(args.jobId as string);
      return removed ? `Job ${(args.jobId as string).slice(0, 8)} removed` : "Job not found";
    }

    if (action === "enable" || action === "disable") {
      if (!args.jobId) return "Error: jobId is required";
      await scheduler.toggleJob(args.jobId as string, action === "enable");
      return `Job ${(args.jobId as string).slice(0, 8)} ${action}d`;
    }

    return "Unknown action";
  },

  formatConfirmation(args: Record<string, unknown>): string {
    if (args.action === "add") return `Schedule: "${args.name}" every ${args.schedule}`;
    return `${args.action} cron job`;
  },
};
