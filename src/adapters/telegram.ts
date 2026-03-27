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

import { Bot, InlineKeyboard } from "grammy";
import { ChannelAdapter, type InboundMessage, type ReplyPayload } from "./base.js";
import { handleAdapterCommand, toolEmoji, splitMessage } from "./commands.js";
import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

/** Per-chat state for thinking display toggle */
const thinkingEnabled = new Map<number, boolean>();

/** Pending tool confirmations — keyed by confirmId */
const pendingConfirms = new Map<string, (v: boolean | "always") => void>();

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
                onConfirm: (actions: unknown[], resolve: (v: boolean | "always") => void) => {
                  const action = (actions as Array<{ name?: string; safetyLevel?: string }>)[0];
                  const toolName = action?.name || "unknown tool";
                  const level = action?.safetyLevel || "high";
                  const confirmId = `confirm_${Date.now()}`;

                  // Store the resolver for the callback_query handler
                  pendingConfirms.set(confirmId, resolve);

                  const keyboard = new InlineKeyboard()
                    .text("✅ Approve", `${confirmId}:yes`)
                    .text("✅ Always", `${confirmId}:always`)
                    .text("❌ Deny", `${confirmId}:no`);

                  const emoji = toolEmoji(toolName);
                  bot.api.sendMessage(
                    chatId,
                    `${emoji} *Tool approval needed*\n\n\`${toolName}\` (${level} risk)\n\nApprove this action?`,
                    { parse_mode: "Markdown", reply_markup: keyboard },
                  ).catch(() => {});

                  // Auto-approve after 30s to prevent hanging
                  setTimeout(() => {
                    if (pendingConfirms.has(confirmId)) {
                      pendingConfirms.delete(confirmId);
                      resolve(true);
                    }
                  }, 30_000);
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

      // Handle inline keyboard callbacks for tool approvals
      bot.on("callback_query:data", async (cbCtx) => {
        const data = cbCtx.callbackQuery.data;
        const [confirmId, choice] = data.split(":");
        const resolve = pendingConfirms.get(confirmId);
        if (!resolve) return;

        pendingConfirms.delete(confirmId);
        await cbCtx.answerCallbackQuery(choice === "no" ? "Denied" : "Approved").catch(() => {});

        const action = (cbCtx.callbackQuery.message as any)?.text?.match(/`([^`]+)`/)?.[1] || "tool";
        await cbCtx.editMessageText(
          choice === "no"
            ? `❌ \`${action}\` — denied`
            : `✅ \`${action}\` — approved`,
          { parse_mode: "Markdown" },
        ).catch(() => {});

        resolve(choice === "always" ? "always" : choice !== "no");
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

  /** Handle slash commands — delegates to shared handler, with Telegram-specific overrides */
  private async handleCommand(text: string, chatId: number, isGroup: boolean): Promise<string | null> {
    const [cmd] = text.slice(1).split(/\s+/);
    const command = cmd.replace(/@\w+$/, "").toLowerCase();

    // Telegram-specific commands
    switch (command) {
      case "think": {
        const current = thinkingEnabled.get(chatId) ?? false;
        thinkingEnabled.set(chatId, !current);
        return !current
          ? "💭 Thinking display *on* — you'll see the model's reasoning above responses."
          : "💭 Thinking display *off* — only the final response will be shown.";
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
    }

    // Delegate to shared command handler
    return handleAdapterCommand(text, {
      gateway: this.gateway,
      config: this.config,
      channel: "telegram",
      chatId,
      isGroup,
    });
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

// splitMessage and toolEmoji imported from ./commands.js
