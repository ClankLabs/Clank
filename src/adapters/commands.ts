/**
 * Shared slash command handler for all channel adapters.
 *
 * Every adapter routes /commands through handleAdapterCommand().
 * Adapter-specific commands (like Telegram's /think) are handled
 * by returning null and letting the adapter handle them.
 */

import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

export interface CommandContext {
  gateway: GatewayServer | null;
  config: ClankConfig | null;
  channel: string;
  chatId: string | number;
  isGroup: boolean;
}

/**
 * Handle a slash command. Returns the response text, or null if
 * the command is not recognized (adapter should handle or pass through).
 */
export async function handleAdapterCommand(
  text: string,
  ctx: CommandContext,
): Promise<string | null> {
  const [cmd, ...args] = text.slice(1).split(/\s+/);
  const command = cmd.replace(/@\w+$/, "").toLowerCase();
  const routeCtx = {
    channel: ctx.channel,
    peerId: ctx.chatId,
    peerKind: (ctx.isGroup ? "group" : "dm") as "dm" | "group",
  };

  switch (command) {
    case "help":
    case "start":
      return [
        "🔧 Clank Commands",
        "",
        "💬 Chat",
        "/new — Start a new session",
        "/reset — Clear current session history",
        "/compact — Save state, clear context, continue",
        "",
        "📊 Info",
        "/status — Agent, model, and session info",
        "/agents — List available agents",
        "/model — Show current model",
        "/tasks — Show background tasks",
        "/kill <id> — Kill a background task",
        "/killall — Kill all running tasks",
        "/version — Show Clank version",
        "",
        "⚙️ Settings",
        "/agent <name> — Switch to a different agent",
      ].join("\n");

    case "status": {
      const model = ctx.config?.agents?.defaults?.model?.primary || "unknown";
      const agentCount = (ctx.config?.agents as any)?.list?.length || 0;
      const tasks = ctx.gateway?.getTaskRegistry()?.list() || [];
      const runningTasks = tasks.filter((t: any) => t.status === "running").length;
      return [
        "📊 Status",
        "",
        `Model: ${model}`,
        `Agents: ${agentCount || 1} configured`,
        `Tasks: ${runningTasks} running / ${tasks.length} total`,
        `Chat: ${ctx.isGroup ? "group" : "DM"} (${ctx.chatId})`,
      ].join("\n");
    }

    case "agents": {
      const list = (ctx.config?.agents as any)?.list || [];
      const defaultModel = ctx.config?.agents?.defaults?.model?.primary || "unknown";
      if (list.length === 0) {
        return `📋 Agents\n\n• default — ${defaultModel}\n\nNo custom agents. Configure in config.json5.`;
      }
      const lines = list.map((a: any) =>
        `• ${a.name || a.id} — ${a.model?.primary || defaultModel}`
      );
      return `📋 Agents\n\n• default — ${defaultModel}\n${lines.join("\n")}\n\nSwitch with /agent <name>`;
    }

    case "agent": {
      if (!args[0]) return "Usage: /agent <name>\n\nSee /agents for available agents.";
      const targetId = args[0].toLowerCase();
      const list = (ctx.config?.agents as any)?.list || [];
      const found = list.find((a: any) =>
        a.id.toLowerCase() === targetId || (a.name || "").toLowerCase() === targetId
      );

      if (!found && targetId !== "default") {
        return `Agent "${args[0]}" not found. See /agents for available agents.`;
      }

      if (ctx.gateway) {
        await ctx.gateway.resetSession(routeCtx);
      }
      const name = found ? (found.name || found.id) : "default";
      return `Switched to agent ${name}. Session reset — send a message to begin.`;
    }

    case "new":
    case "reset":
      if (ctx.gateway) {
        await ctx.gateway.resetSession(routeCtx);
      }
      return command === "new"
        ? "✨ New session started. Send a message to begin."
        : "🗑 Session cleared. History erased.";

    case "compact": {
      if (!ctx.gateway) return "Gateway not connected.";
      const summary = await ctx.gateway.compactSession(routeCtx);
      if (!summary) return "Nothing to compact — no active session.";
      const preview = summary.length > 300 ? summary.slice(0, 300) + "..." : summary;
      return `📦 Session compacted.\n\n${preview}`;
    }

    case "model": {
      const model = ctx.config?.agents?.defaults?.model?.primary || "unknown";
      const fallbacks = (ctx.config?.agents?.defaults?.model as any)?.fallbacks || [];
      const lines = [`🤖 Current Model\n\nPrimary: ${model}`];
      if (fallbacks.length > 0) {
        lines.push(`Fallbacks: ${fallbacks.join(", ")}`);
      }
      return lines.join("\n");
    }

    case "tasks": {
      const tasks = ctx.gateway?.getTaskRegistry()?.list() || [];
      if (tasks.length === 0) return "📋 No background tasks.";
      const lines = tasks.map((t: any) => {
        const elapsed = Math.round(((t.completedAt || Date.now()) - t.startedAt) / 1000);
        const status = t.status === "running" ? "⏳" : t.status === "completed" ? "✅" : t.status === "failed" ? "❌" : "⏱";
        const depth = t.spawnDepth > 0 ? ` [depth ${t.spawnDepth}]` : "";
        const shortId = t.id.slice(0, 8);
        return `${status} ${shortId} ${t.label.slice(0, 35)} (${t.agentId})${depth} — ${elapsed}s`;
      });
      return `📋 Background Tasks\n\n${lines.join("\n")}\n\nKill with /kill <id> or /killall`;
    }

    case "kill": {
      if (!ctx.gateway) return "Gateway not connected.";
      if (!args[0]) return "Usage: /kill <task-id>\n\nSee /tasks for task IDs.";

      const registry = ctx.gateway.getTaskRegistry();
      const shortId = args[0];
      const allTasks = registry.list();
      const match = allTasks.find((t: any) => t.id.startsWith(shortId) && t.status === "running");
      if (!match) return `No running task matching ${shortId}. See /tasks.`;

      const subEngine = (ctx.gateway as any).engines?.get(`task:${match.id}`);
      if (subEngine) {
        subEngine.cancel();
        subEngine.destroy();
        (ctx.gateway as any).engines?.delete(`task:${match.id}`);
      }

      registry.cancel(match.id);
      const cascaded = registry.cascadeCancel(`task:${match.id}`);
      const cascade = cascaded > 0 ? ` + ${cascaded} child task(s)` : "";
      return `🗑 Killed task ${match.id.slice(0, 8)} — ${match.label.slice(0, 40)}${cascade}`;
    }

    case "killall": {
      if (!ctx.gateway) return "Gateway not connected.";
      const registry = ctx.gateway.getTaskRegistry();
      const running = registry.list({ status: "running" });
      if (running.length === 0) return "No running tasks to kill.";

      for (const t of running) {
        const subEngine = (ctx.gateway as any).engines?.get(`task:${t.id}`);
        if (subEngine) {
          subEngine.cancel();
          subEngine.destroy();
          (ctx.gateway as any).engines?.delete(`task:${t.id}`);
        }
        registry.cancel(t.id);
      }
      return `🗑 Killed ${running.length} running task(s).`;
    }

    case "version":
      return "🔧 Clank v1.9.0";

    default:
      return null; // Not a shared command — let adapter handle it
  }
}

/** Map tool names to descriptive emojis */
export function toolEmoji(name: string): string {
  const map: Record<string, string> = {
    read_file: "📄", write_file: "✏️", edit_file: "✏️",
    list_directory: "📁", search_files: "🔍", glob_files: "🔍",
    bash: "💻", git: "📦",
    web_search: "🌐", web_fetch: "🌐",
    spawn_task: "🚀", manage_agent: "🤖", manage_model: "🧠",
    manage_config: "⚙️", manage_session: "📋", manage_cron: "⏰",
    tts: "🔊", stt: "🎤",
  };
  return map[name] || "🔧";
}

/** Split a long message into chunks at newline boundaries */
export function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) { chunks.push(remaining); break; }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
