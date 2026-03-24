/**
 * Background task tool — spawn, control, and monitor sub-agent tasks.
 *
 * Actions:
 * - spawn: Start a background task on a sub-agent
 * - status: Check a specific task
 * - list: See all tasks
 * - kill: Cancel a running task (+ cascade children)
 * - steer: Kill and re-spawn with new instructions
 * - message: Send a message to a running child's engine
 *
 * Only agents within the spawn depth limit can use 'spawn'.
 * Leaf agents (at max depth) cannot spawn further.
 */

import type { Tool, ToolContext, ValidationResult, SafetyLevel } from "../types.js";

export const taskTool: Tool = {
  definition: {
    name: "spawn_task",
    description:
      "Manage background tasks on sub-agents. " +
      "'spawn' starts a task that runs independently while you continue chatting. " +
      "'kill' cancels a running task. 'steer' kills and re-spawns with new instructions. " +
      "'message' sends a message to a running child. 'status' checks one task. 'list' shows all.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action: 'spawn', 'status', 'list', 'kill', 'steer', or 'message'",
        },
        agentId: {
          type: "string",
          description: "Agent ID to run the task (required for spawn). Use 'default' for the default agent.",
        },
        prompt: {
          type: "string",
          description: "The instruction for the sub-agent (required for spawn)",
        },
        message: {
          type: "string",
          description: "Message to send (required for steer and message actions)",
        },
        label: {
          type: "string",
          description: "Human-readable task name (optional for spawn)",
        },
        taskId: {
          type: "string",
          description: "Task ID (required for status, kill, steer, message)",
        },
        timeoutMs: {
          type: "number",
          description: "Timeout in ms (optional, default 300000 = 5 minutes)",
        },
      },
      required: ["action"],
    },
  },

  safetyLevel: ((args: Record<string, unknown>): SafetyLevel => {
    const action = args.action as string;
    return (action === "spawn" || action === "kill" || action === "steer") ? "medium" : "low";
  }) as SafetyLevel | ((args: Record<string, unknown>) => SafetyLevel),

  readOnly: false,

  validate(args: Record<string, unknown>, _ctx: ToolContext): ValidationResult {
    const action = args.action as string;
    if (!["spawn", "status", "list", "kill", "steer", "message"].includes(action)) {
      return { ok: false, error: "action must be 'spawn', 'status', 'list', 'kill', 'steer', or 'message'" };
    }
    if (action === "spawn") {
      if (!args.agentId || typeof args.agentId !== "string") {
        return { ok: false, error: "agentId is required for spawn" };
      }
      if (!args.prompt || typeof args.prompt !== "string") {
        return { ok: false, error: "prompt is required for spawn" };
      }
    }
    if (["status", "kill", "message"].includes(action) && (!args.taskId || typeof args.taskId !== "string")) {
      return { ok: false, error: "taskId is required for " + action };
    }
    if (action === "steer" && (!args.taskId || !args.message)) {
      return { ok: false, error: "taskId and message are required for steer" };
    }
    if (action === "message" && !args.message) {
      return { ok: false, error: "message is required for message action" };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = args.action as string;

    switch (action) {
      case "spawn": {
        if (!ctx.spawnTask) {
          if (ctx.spawnDepth !== undefined && ctx.maxSpawnDepth !== undefined && ctx.spawnDepth >= ctx.maxSpawnDepth) {
            return "Error: This agent is at maximum spawn depth and cannot create sub-agents.";
          }
          return "Error: spawn_task is not available in this context.";
        }

        // Check concurrent limit
        if (ctx.taskRegistry && ctx.sessionKey) {
          const active = ctx.taskRegistry.countActiveByParent(ctx.sessionKey);
          if (active >= 8) {
            return `Error: Concurrent task limit reached (${active}/8 running). Kill a task first.`;
          }
        }

        const agentId = args.agentId as string;
        const prompt = args.prompt as string;
        const label = (args.label as string) || prompt.slice(0, 60);
        const timeoutMs = (args.timeoutMs as number) || 300_000;

        try {
          const taskId = await ctx.spawnTask({ agentId, prompt, label, timeoutMs });
          return `Task spawned successfully.\nTask ID: ${taskId}\nAgent: ${agentId}\nLabel: ${label}\nTimeout: ${Math.round(timeoutMs / 1000)}s\n\nThe task is running in the background. Results will be delivered when the task completes.`;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return `Error spawning task: ${msg}`;
        }
      }

      case "kill": {
        if (!ctx.killTask) return "Error: kill is not available in this context.";
        try {
          const result = await ctx.killTask(args.taskId as string);
          if (result.status === "not_found") return `No running task found with ID: ${args.taskId}`;
          if (result.status === "not_owner") return `Cannot kill task ${args.taskId} — it was not spawned by this agent.`;
          return `Task ${args.taskId} killed.${result.cascadeKilled ? ` ${result.cascadeKilled} child task(s) also cancelled.` : ""}`;
        } catch (err: unknown) {
          return `Error killing task: ${err instanceof Error ? err.message : err}`;
        }
      }

      case "steer": {
        if (!ctx.killTask || !ctx.spawnTask) return "Error: steer is not available in this context.";
        const taskId = args.taskId as string;
        const message = args.message as string;

        // Get the original task info before killing
        const task = ctx.taskRegistry?.get(taskId);
        if (!task) return `No task found with ID: ${taskId}`;

        // Kill the old task
        await ctx.killTask(taskId);

        // Spawn a new one with the new instructions
        try {
          const newId = await ctx.spawnTask({
            agentId: task.agentId,
            prompt: message,
            label: task.label + " (steered)",
            timeoutMs: task.timeoutMs,
          });
          return `Task ${taskId} killed and re-spawned.\nNew Task ID: ${newId}\nNew instructions: ${message.slice(0, 100)}`;
        } catch (err: unknown) {
          return `Killed old task but failed to re-spawn: ${err instanceof Error ? err.message : err}`;
        }
      }

      case "message": {
        if (!ctx.messageTask) return "Error: message is not available in this context.";
        try {
          const result = await ctx.messageTask(args.taskId as string, args.message as string);
          if (result.status === "not_found") return `No running task found with ID: ${args.taskId}`;
          if (result.status === "not_owner") return `Cannot message task ${args.taskId} — it was not spawned by this agent.`;
          return `Message sent to task ${args.taskId}.\nReply: ${result.replyText || "(no reply)"}`;
        } catch (err: unknown) {
          return `Error messaging task: ${err instanceof Error ? err.message : err}`;
        }
      }

      case "status": {
        if (!ctx.taskRegistry) return "Error: Task registry not available.";
        const task = ctx.taskRegistry.get(args.taskId as string);
        if (!task) return `No task found with ID: ${args.taskId}`;

        const elapsed = Math.round((Date.now() - task.startedAt) / 1000);
        const lines = [
          `Task: ${task.label}`,
          `ID: ${task.id}`,
          `Agent: ${task.agentId}`,
          `Model: ${task.model}`,
          `Status: ${task.status}`,
          `Depth: ${task.spawnDepth}`,
          `Elapsed: ${elapsed}s`,
          `Children: ${task.children.length}`,
        ];
        if (task.result) lines.push(`Result: ${task.result.slice(0, 500)}`);
        if (task.error) lines.push(`Error: ${task.error}`);
        return lines.join("\n");
      }

      case "list": {
        if (!ctx.taskRegistry) return "Error: Task registry not available.";
        const tasks = ctx.taskRegistry.list();
        if (tasks.length === 0) return "No background tasks.";

        return tasks.map((t) => {
          const elapsed = Math.round(((t.completedAt || Date.now()) - t.startedAt) / 1000);
          const depth = t.spawnDepth > 0 ? ` [depth ${t.spawnDepth}]` : "";
          return `• [${t.status}] ${t.label}${depth} (agent: ${t.agentId}, ${elapsed}s)`;
        }).join("\n");
      }

      default:
        return `Unknown action: ${action}`;
    }
  },

  formatConfirmation(args: Record<string, unknown>): string {
    const action = args.action as string;
    if (action === "spawn") return `Spawn background task on agent "${args.agentId}": ${(args.prompt as string)?.slice(0, 80)}`;
    if (action === "kill") return `Kill task ${args.taskId}`;
    if (action === "steer") return `Steer task ${args.taskId} with new instructions`;
    return `${action} task`;
  },
};
