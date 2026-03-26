/**
 * Telegram channel adapter.
 *
 * Built on grammY. Supports:
 * - DM and group chats with separate allowlists
 * - @mention checking in groups
 * - Streaming via message editing
 * - Voice messages (STT → agent → TTS)
 * - Photo and document handling
 * - Slash commands with Telegram bot menu
 * - Per-chat message queue
 */

import { Bot } from "grammy";
import { ChannelAdapter, type InboundMessage, type ReplyPayload } from "./base.js";
import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

/** Per-chat state for thinking display toggle */
const thinkingEnabled = new Map<number, boolean>();

export class TelegramAdapter extends ChannelAdapter {
  readonly id = "telegram";
  readonly name = "Telegram";
  private gateway: GatewayServer | null = null;
  private config: ClankConfig | null = null;
  private bot: Bot | null = null;
  private running = false;
  private startedAt: number = 0;

  init(gateway: GatewayServer, config: ClankConfig): void {
    this.gateway = gateway;
    this.config = config;
  }

  async start(): Promise<void> {
    const telegramConfig = this.config?.channels?.telegram;
    if (!telegramConfig?.enabled || !telegramConfig.botToken) {
      console.log("  Telegram: disabled or no bot token configured");
      return;
    }

    this.startedAt = Date.now();

    try {
      this.bot = new Bot(telegramConfig.botToken);
      const bot = this.bot as Bot;

      // Register bot commands with Telegram so they show up in the / menu
      await bot.api.setMyCommands([
        { command: "help", description: "Show available commands" },
        { command: "new", description: "Start a new session" },
        { command: "reset", description: "Clear current session" },
        { command: "compact", description: "Save state and clear context" },
        { command: "status", description: "Agent status and info" },
        { command: "agents", description: "List available agents" },
        { command: "tasks", description: "Show background tasks" },
        { command: "kill", description: "Kill a background task" },
        { command: "killall", description: "Kill all running tasks" },
        { command: "model", description: "Show current model" },
        { command: "sessions", description: "List recent sessions" },
        { command: "think", description: "Toggle thinking display" },
        { command: "version", description: "Show Clank version" },
      ]).catch(() => {}); // Non-critical if this fails

      // Track startup time — messages older than this are stale
      const startupTime = Math.floor(Date.now() / 1000);
      // Per-chat processing queue — prevents parallel model calls from same chat
      const chatLocks = new Map<number, Promise<void>>();

      // Handle text messages
      bot.on("message:text", async (ctx) => {
        const msg = ctx.message;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

        // Drop stale messages from before this startup (queued while offline)
        if (msg.date < startupTime - 30) {
          console.log(`  Telegram: dropping stale message from ${userId} (${startupTime - msg.date}s old)`);
          return;
        }

        // Permission check — allowFrom can contain user IDs (numeric) or usernames (@name)
        if (telegramConfig.allowFrom && telegramConfig.allowFrom.length > 0) {
          const username = msg.from?.username ? `@${msg.from.username}` : "";
          const userIdStr = String(userId || "");
          const allowed = telegramConfig.allowFrom.map(String);
          const isAllowed = allowed.some((a) =>
            a === userIdStr ||
            a.toLowerCase() === username.toLowerCase() ||
            a.toLowerCase() === (msg.from?.username || "").toLowerCase()
          );
          if (!isAllowed) return;
        }

        // Mention check in groups
        if (isGroup) {
          const groupConfig = telegramConfig.groups?.[String(chatId)];
          if (groupConfig?.requireMention !== false) {
            const botInfo = await bot.api.getMe();
            if (!msg.text.includes(`@${botInfo.username}`)) return;
          }
        }

        // Handle slash commands (lightweight, no queueing needed)
        if (msg.text.startsWith("/")) {
          const reply = await this.handleCommand(msg.text, chatId, isGroup);
          if (reply) {
            await ctx.api.sendMessage(chatId, reply, { parse_mode: "Markdown" });
          }
          return;
        }

        // Queue messages per chat — process one at a time to prevent
        // parallel model calls from flooding the local model
        const processMessage = async () => {
          if (!this.gateway) return;

          try {
            console.log(`  Telegram: processing message from ${userId} in ${chatId}`);
            await ctx.api.sendChatAction(chatId, "typing").catch(() => {});

            // Keep sending "typing" every 4s while the model processes
            const typingInterval = setInterval(() => {
              bot.api.sendChatAction(chatId, "typing").catch(() => {});
            }, 4000);

            // Streaming: send initial message then edit as tokens arrive
            let streamMsgId: number | null = null;
            let sendingInitial = false;
            let accumulated = "";
            let thinkingText = "";
            let lastEditTime = 0;
            const EDIT_INTERVAL = 800;
            const showThinking = thinkingEnabled.get(chatId) ?? false;
            let toolIndicators: Array<{ name: string; done?: boolean }> = [];

            const response = await this.gateway.handleInboundMessageStreaming(
              {
                channel: "telegram",
                peerId: chatId,
                peerKind: isGroup ? "group" : "dm",
              },
              msg.text,
              {
                onToken: (content: string) => {
                  accumulated += content;
                  const now = Date.now();

                  if (!streamMsgId && !sendingInitial && accumulated.length > 20) {
                    sendingInitial = true;
                    const display = buildStreamDisplay(accumulated, thinkingText, toolIndicators, showThinking);
                    bot.api.sendMessage(chatId, display + " ▍").then((sent) => {
                      streamMsgId = sent.message_id;
                      lastEditTime = now;
                    }).catch(() => {});
                    return;
                  }

                  if (streamMsgId && now - lastEditTime > EDIT_INTERVAL) {
                    lastEditTime = now;
                    const display = buildStreamDisplay(accumulated, thinkingText, toolIndicators, showThinking);
                    const truncated = display.length > 4000
                      ? display.slice(-3900) + " ▍"
                      : display + " ▍";
                    bot.api.editMessageText(chatId, streamMsgId, truncated).catch(() => {});
                  }
                },
                onThinking: (content: string) => {
                  thinkingText += content;
                },
                onToolStart: (name: string) => {
                  toolIndicators.push({ name });
                  if (streamMsgId) {
                    const display = buildStreamDisplay(accumulated, thinkingText, toolIndicators, showThinking);
                    bot.api.editMessageText(chatId, streamMsgId, display + " ▍").catch(() => {});
                  } else {
                    bot.api.sendChatAction(chatId, "typing").catch(() => {});
                  }
                },
                onToolResult: (name: string, success: boolean) => {
                  const tool = toolIndicators.find((t) => t.name === name && t.done === undefined);
                  if (tool) tool.done = success;
                },
                onError: (message: string) => {
                  bot.api.sendMessage(chatId, `⚠️ ${message.slice(0, 200)}`).catch(() => {});
                },
              },
            );

            // Final edit with complete response
            if (sendingInitial && !streamMsgId) {
              await new Promise<void>((r) => {
                const check = setInterval(() => {
                  if (streamMsgId) { clearInterval(check); r(); }
                }, 50);
                setTimeout(() => { clearInterval(check); r(); }, 3000);
              });
            }

            if (streamMsgId && response) {
              const display = buildFinalDisplay(response, thinkingText, toolIndicators, showThinking);
              const finalText = display.length > 4000
                ? display.slice(0, 3950) + "\n... (truncated)"
                : display;
              await bot.api.editMessageText(chatId, streamMsgId, finalText).catch(() => {});
            } else if (response && !streamMsgId) {
              const display = buildFinalDisplay(response, thinkingText, toolIndicators, showThinking);
              const chunks = splitMessage(display, 4000);
              for (const chunk of chunks) {
                await ctx.api.sendMessage(chatId, chunk);
              }
            }
            console.log(`  Telegram: response complete (${response?.length || 0} chars)`);
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`  Telegram: message handler error — ${errMsg}`);
            await ctx.api.sendMessage(chatId, `⚠️ Error: ${errMsg.slice(0, 200)}`).catch(() => {});
          } finally {
            clearInterval(typingInterval);
          }
        };

        const prev = chatLocks.get(chatId) || Promise.resolve();
        const next = prev.then(processMessage).catch((err) => {
          console.error(`  Telegram: queue error — ${err instanceof Error ? err.message : err}`);
        });
        chatLocks.set(chatId, next);
      });

      // Handle voice messages — transcribe and route through agent
      bot.on("message:voice", async (ctx) => {
        const msg = ctx.message;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;

        if (telegramConfig.allowFrom && telegramConfig.allowFrom.length > 0) {
          const username = msg.from?.username ? `@${msg.from.username}` : "";
          const userIdStr = String(userId || "");
          const allowed = telegramConfig.allowFrom.map(String);
          const isAllowed = allowed.some((a) =>
            a === userIdStr ||
            a.toLowerCase() === username.toLowerCase() ||
            a.toLowerCase() === (msg.from?.username || "").toLowerCase()
          );
          if (!isAllowed) return;
        }

        if (msg.date < startupTime - 30) return;

        const processVoice = async () => {
          if (!this.gateway || !this.config) return;

          try {
            await ctx.api.sendChatAction(chatId, "typing").catch(() => {});

            const file = await ctx.api.getFile(msg.voice.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;
            const res = await fetch(fileUrl);
            if (!res.ok) { await ctx.api.sendMessage(chatId, "⚠️ Could not download voice message"); return; }
            const audioBuffer = Buffer.from(await res.arrayBuffer());

            const { STTEngine } = await import("../voice/index.js");
            const { loadConfig } = await import("../config/index.js");
            const config = await loadConfig();
            const stt = new STTEngine(config);

            if (!stt.isAvailable()) {
              await ctx.api.sendMessage(chatId, "Voice messages require speech-to-text. Configure Whisper in settings.");
              return;
            }

            const transcription = await stt.transcribe(audioBuffer, "ogg");
            if (!transcription?.text) {
              await ctx.api.sendMessage(chatId, "Could not transcribe voice message.");
              return;
            }

            const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
            const response = await this.gateway.handleInboundMessage(
              { channel: "telegram", peerId: chatId, peerKind: isGroup ? "group" : "dm" },
              `[Voice message transcription]: ${transcription.text}`,
            );

            if (response) {
              const { TTSEngine } = await import("../voice/index.js");
              const tts = new TTSEngine(config);

              if (tts.isAvailable() && response.length < 2000) {
                const agentVoice = config.agents.list.find((a: any) => a.voiceId)?.voiceId;
                const audio = await tts.synthesize(response, { voiceId: agentVoice });
                if (audio) {
                  const { InputFile } = await import("grammy");
                  await ctx.api.sendVoice(chatId, new InputFile(audio.audioBuffer, "reply.mp3"));
                  return;
                }
              }

              const chunks = splitMessage(response, 4000);
              for (const chunk of chunks) {
                await ctx.api.sendMessage(chatId, chunk);
              }
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await ctx.api.sendMessage(chatId, `⚠️ Error: ${errMsg.slice(0, 200)}`);
          }
        };

        const prev = chatLocks.get(chatId) || Promise.resolve();
        const next = prev.then(processVoice).catch(() => {});
        chatLocks.set(chatId, next);
      });

      // Handle photo messages
      bot.on("message:photo", async (ctx) => {
        const msg = ctx.message;
        const chatId = msg.chat.id;
        if (msg.date < startupTime - 30) return;

        if (telegramConfig.allowFrom && telegramConfig.allowFrom.length > 0) {
          const username = msg.from?.username ? `@${msg.from.username}` : "";
          const userIdStr = String(msg.from?.id || "");
          const allowed = telegramConfig.allowFrom.map(String);
          if (!allowed.some((a) => a === userIdStr || a.toLowerCase() === username.toLowerCase() || a.toLowerCase() === (msg.from?.username || "").toLowerCase())) return;
        }

        const processPhoto = async () => {
          if (!this.gateway) return;
          try {
            const photo = msg.photo[msg.photo.length - 1];
            const file = await bot.api.getFile(photo.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;

            const caption = msg.caption || "";
            const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

            const response = await this.gateway.handleInboundMessage(
              { channel: "telegram", peerId: chatId, peerKind: isGroup ? "group" : "dm" },
              `[Image received: ${fileUrl}]${caption ? ` Caption: ${caption}` : ""}\n\nDescribe or analyze the image if you can, or acknowledge it.`,
            );

            if (response) {
              const chunks = splitMessage(response, 4000);
              for (const chunk of chunks) await ctx.api.sendMessage(chatId, chunk);
            }
          } catch (err: unknown) {
            await ctx.api.sendMessage(chatId, `⚠️ Error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
          }
        };

        const prev = chatLocks.get(chatId) || Promise.resolve();
        chatLocks.set(chatId, prev.then(processPhoto).catch(() => {}));
      });

      // Handle document/file messages
      bot.on("message:document", async (ctx) => {
        const msg = ctx.message;
        const chatId = msg.chat.id;
        if (msg.date < startupTime - 30) return;

        if (telegramConfig.allowFrom && telegramConfig.allowFrom.length > 0) {
          const username = msg.from?.username ? `@${msg.from.username}` : "";
          const userIdStr = String(msg.from?.id || "");
          const allowed = telegramConfig.allowFrom.map(String);
          if (!allowed.some((a) => a === userIdStr || a.toLowerCase() === username.toLowerCase() || a.toLowerCase() === (msg.from?.username || "").toLowerCase())) return;
        }

        const processDoc = async () => {
          if (!this.gateway) return;
          try {
            const doc = msg.document;
            if (!doc) return;

            if (doc.file_size && doc.file_size > 10 * 1024 * 1024) {
              await ctx.api.sendMessage(chatId, "File too large (max 10MB).");
              return;
            }

            const file = await bot.api.getFile(doc.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;
            const res = await fetch(fileUrl);
            if (!res.ok) { await ctx.api.sendMessage(chatId, "Could not download file."); return; }

            const { writeFile: wf } = await import("node:fs/promises");
            const { join } = await import("node:path");
            const { tmpdir } = await import("node:os");
            const safeName = (doc.file_name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
            const savePath = join(tmpdir(), `clank-upload-${Date.now()}-${safeName}`);
            await wf(savePath, Buffer.from(await res.arrayBuffer()));

            const caption = msg.caption || "";
            const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

            const response = await this.gateway.handleInboundMessage(
              { channel: "telegram", peerId: chatId, peerKind: isGroup ? "group" : "dm" },
              `[File received: "${doc.file_name}" saved to ${savePath}]${caption ? ` Note: ${caption}` : ""}\n\nYou can read this file with the read_file tool.`,
            );

            if (response) {
              const chunks = splitMessage(response, 4000);
              for (const chunk of chunks) await ctx.api.sendMessage(chatId, chunk);
            }
          } catch (err: unknown) {
            await ctx.api.sendMessage(chatId, `⚠️ Error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
          }
        };

        const prev = chatLocks.get(chatId) || Promise.resolve();
        chatLocks.set(chatId, prev.then(processDoc).catch(() => {}));
      });

      bot.start({
        onStart: () => {
          this.running = true;
          console.log("  Telegram: polling started");
        },
      }).catch((err: Error) => {
        console.error(`  Telegram: polling error — ${err.message}`);
        this.running = false;
      });

      console.log("  Telegram: connecting...");
    } catch (err) {
      console.error(`  Telegram: failed to start — ${err instanceof Error ? err.message : err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.bot && this.running) {
      (this.bot as Bot).stop();
      this.running = false;
    }
  }

  /** Handle slash commands from Telegram */
  private async handleCommand(text: string, chatId: number, isGroup: boolean): Promise<string | null> {
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const command = cmd.replace(/@\w+$/, "");

    switch (command) {
      case "help":
      case "start":
        return [
          "🔧 *Clank Commands*",
          "",
          "💬 *Chat*",
          "/new — Start a new session",
          "/reset — Clear current session history",
          "/compact — Save state, clear context, continue",
          "",
          "📊 *Info*",
          "/status — Agent, model, and session info",
          "/agents — List available agents",
          "/model — Show current model",
          "/tasks — Show background tasks",
          "/kill <id> — Kill a background task",
          "/killall — Kill all running tasks",
          "/version — Show Clank version",
          "",
          "⚙️ *Settings*",
          "/agent <name> — Switch to a different agent",
          "/think — Toggle thinking display",
          "",
          "_Send any message to chat with the agent._",
        ].join("\n");

      case "status": {
        const cfg = this.config;
        const model = cfg?.agents?.defaults?.model?.primary || "unknown";
        const agentCount = cfg?.agents?.list?.length || 0;
        const tasks = this.gateway?.getTaskRegistry()?.list() || [];
        const runningTasks = tasks.filter((t) => t.status === "running").length;
        const uptime = Math.round((Date.now() - this.startedAt) / 60000);
        const thinking = thinkingEnabled.get(chatId) ? "on" : "off";

        return [
          "📊 *Status*",
          "",
          `*Model:* \`${model}\``,
          `*Agents:* ${agentCount || 1} configured`,
          `*Tasks:* ${runningTasks} running / ${tasks.length} total`,
          `*Thinking:* ${thinking}`,
          `*Chat:* ${isGroup ? "group" : "DM"} (\`${chatId}\`)`,
          `*Uptime:* ${uptime} min`,
        ].join("\n");
      }

      case "agents": {
        const list = this.config?.agents?.list || [];
        const defaultModel = this.config?.agents?.defaults?.model?.primary || "unknown";
        if (list.length === 0) {
          return `📋 *Agents*\n\n• *default* — \`${defaultModel}\`\n\n_No custom agents. Configure in config.json5._`;
        }
        const lines = list.map((a) =>
          `• *${a.name || a.id}* — \`${a.model?.primary || defaultModel}\``
        );
        return `📋 *Agents*\n\n• *default* — \`${defaultModel}\`\n${lines.join("\n")}\n\n_Switch with /agent <name>_`;
      }

      case "agent": {
        if (!args[0]) return "Usage: /agent <name>\n\nSee /agents for available agents.";
        const targetId = args[0].toLowerCase();
        const list = this.config?.agents?.list || [];
        const found = list.find((a) => a.id.toLowerCase() === targetId || (a.name || "").toLowerCase() === targetId);

        if (!found && targetId !== "default") {
          return `Agent "${args[0]}" not found. See /agents for available agents.`;
        }

        // Reset session to switch agent — the new session key will route to the new agent
        if (this.gateway) {
          await this.gateway.resetSession({
            channel: "telegram",
            peerId: chatId,
            peerKind: isGroup ? "group" : "dm",
          });
        }
        const name = found ? (found.name || found.id) : "default";
        return `Switched to agent *${name}*. Session reset — send a message to begin.`;
      }

      case "sessions": {
        if (!this.gateway) return "Gateway not connected.";
        return [
          "📁 *Sessions*",
          "",
          "/new — Start a fresh session",
          "/reset — Clear current session history",
          "",
          `Current: \`${isGroup ? "group" : "dm"}:telegram:${chatId}\``,
        ].join("\n");
      }

      case "new":
      case "reset":
        if (this.gateway) {
          await this.gateway.resetSession({
            channel: "telegram",
            peerId: chatId,
            peerKind: isGroup ? "group" : "dm",
          });
        }
        return command === "new"
          ? "✨ New session started. Send a message to begin."
          : "🗑 Session cleared. History erased.";

      case "compact": {
        if (!this.gateway) return "Gateway not connected.";
        const summary = await this.gateway.compactSession({
          channel: "telegram",
          peerId: chatId,
          peerKind: isGroup ? "group" : "dm",
        });
        if (!summary) return "Nothing to compact — no active session.";
        const preview = summary.length > 300 ? summary.slice(0, 300) + "..." : summary;
        return `📦 *Session compacted*\n\nContext cleared and state saved. The agent will continue where it left off.\n\n_Summary:_\n${preview}`;
      }

      case "model": {
        const model = this.config?.agents?.defaults?.model?.primary || "unknown";
        const fallbacks = this.config?.agents?.defaults?.model?.fallbacks || [];
        const lines = [`🤖 *Current Model*\n\nPrimary: \`${model}\``];
        if (fallbacks.length > 0) {
          lines.push(`Fallbacks: ${fallbacks.map((f) => `\`${f}\``).join(", ")}`);
        }
        return lines.join("\n");
      }

      case "tasks": {
        const tasks = this.gateway?.getTaskRegistry()?.list() || [];
        if (tasks.length === 0) return "📋 No background tasks.";
        const lines = tasks.map((t) => {
          const elapsed = Math.round(((t.completedAt || Date.now()) - t.startedAt) / 1000);
          const status = t.status === "running" ? "⏳" : t.status === "completed" ? "✅" : t.status === "failed" ? "❌" : "⏱";
          const depth = t.spawnDepth > 0 ? ` [depth ${t.spawnDepth}]` : "";
          const kids = t.children.length > 0 ? ` (${t.children.length} children)` : "";
          const shortId = t.id.slice(0, 8);
          return `${status} \`${shortId}\` *${t.label.slice(0, 35)}* (${t.agentId})${depth}${kids} — ${elapsed}s`;
        });
        return `📋 *Background Tasks*\n\n${lines.join("\n")}\n\n_Kill with /kill <id> or /killall_`;
      }

      case "kill": {
        if (!this.gateway) return "Gateway not connected.";
        if (!args[0]) return "Usage: /kill <task-id>\n\nSee /tasks for task IDs.";

        const registry = this.gateway.getTaskRegistry();
        const shortId = args[0];
        // Match by prefix (short IDs from /tasks)
        const allTasks = registry.list();
        const match = allTasks.find((t) => t.id.startsWith(shortId) && t.status === "running");
        if (!match) return `No running task matching \`${shortId}\`. See /tasks.`;

        // Cancel the engine
        const subEngine = (this.gateway as any).engines?.get(`task:${match.id}`);
        if (subEngine) {
          subEngine.cancel();
          subEngine.destroy();
          (this.gateway as any).engines?.delete(`task:${match.id}`);
        }

        registry.cancel(match.id);
        const cascaded = registry.cascadeCancel(`task:${match.id}`);
        const cascade = cascaded > 0 ? ` + ${cascaded} child task(s)` : "";
        return `🗑 Killed task \`${match.id.slice(0, 8)}\` — *${match.label.slice(0, 40)}*${cascade}`;
      }

      case "killall": {
        if (!this.gateway) return "Gateway not connected.";
        const registry = this.gateway.getTaskRegistry();
        const running = registry.list({ status: "running" });
        if (running.length === 0) return "No running tasks to kill.";

        for (const t of running) {
          const subEngine = (this.gateway as any).engines?.get(`task:${t.id}`);
          if (subEngine) {
            subEngine.cancel();
            subEngine.destroy();
            (this.gateway as any).engines?.delete(`task:${t.id}`);
          }
          registry.cancel(t.id);
        }

        return `🗑 Killed *${running.length}* running task(s).`;
      }

      case "think": {
        const current = thinkingEnabled.get(chatId) ?? false;
        thinkingEnabled.set(chatId, !current);
        return !current
          ? "💭 Thinking display *on* — you'll see the model's reasoning above responses."
          : "💭 Thinking display *off* — only the final response will be shown.";
      }

      case "version": {
        return `🔧 *Clank* v1.7.4`;
      }

      default:
        return null;
    }
  }

  async send(sessionKey: string, payload: ReplyPayload): Promise<void> {
    const parts = sessionKey.split(":");
    const chatId = parts[parts.length - 1];
    if (!chatId || !this.bot) return;

    if (payload.text) {
      const chunks = splitMessage(payload.text, 4000);
      for (const chunk of chunks) {
        await (this.bot as Bot).api.sendMessage(Number(chatId), chunk);
      }
    }
  }
}

/** Map tool names to descriptive emojis */
function toolEmoji(name: string): string {
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

/** Format a tool name with emoji */
function formatTool(name: string, done?: boolean): string {
  const emoji = toolEmoji(name);
  if (done === undefined) return `${emoji} ${name}`;
  return done ? `${emoji} ${name} ✓` : `${emoji} ${name} ✗`;
}

/** Build the display text during streaming */
function buildStreamDisplay(
  response: string,
  thinking: string,
  tools: Array<{ name: string; done?: boolean }>,
  showThinking: boolean,
): string {
  const parts: string[] = [];

  if (showThinking && thinking) {
    const truncated = thinking.length > 500 ? thinking.slice(-450) + "..." : thinking;
    parts.push(`💭 ${truncated}`);
    parts.push("");
  }

  if (tools.length > 0) {
    const toolLine = tools.map((t) => {
      if (t.done === undefined) return `${toolEmoji(t.name)} ${t.name}...`;
      return formatTool(t.name, t.done);
    }).join("  ");
    parts.push(toolLine);
    parts.push("");
  }

  parts.push(response);
  return parts.join("\n");
}

/** Build the final display text after streaming completes */
function buildFinalDisplay(
  response: string,
  thinking: string,
  tools: Array<{ name: string; done?: boolean }>,
  showThinking: boolean,
): string {
  const parts: string[] = [];

  if (showThinking && thinking) {
    const truncated = thinking.length > 1000 ? thinking.slice(0, 950) + "..." : thinking;
    parts.push(`💭 _${truncated}_`);
    parts.push("");
  }

  if (tools.length > 0) {
    const toolLine = tools.map((t) => formatTool(t.name, t.done ?? true)).join("  ");
    parts.push(toolLine);
    parts.push("");
  }

  parts.push(response);
  return parts.join("\n");
}

/** Split a long message into chunks that fit Telegram's limit */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
