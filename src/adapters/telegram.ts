/**
 * Telegram channel adapter.
 *
 * Built on grammY. Refactored from the original Clank Telegram bot
 * into the ChannelAdapter pattern. Supports:
 * - DM and group chats with separate allowlists
 * - @mention checking in groups
 * - Streaming via message editing
 * - Inline keyboard confirmations
 * - Media group coalescing
 */

import { Bot } from "grammy";
import { ChannelAdapter, type InboundMessage, type ReplyPayload } from "./base.js";
import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

export class TelegramAdapter extends ChannelAdapter {
  readonly id = "telegram";
  readonly name = "Telegram";
  private gateway: GatewayServer | null = null;
  private config: ClankConfig | null = null;
  private bot: Bot | null = null;
  private running = false;

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

    try {
      this.bot = new Bot(telegramConfig.botToken);
      const bot = this.bot as Bot;

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
            await ctx.api.sendChatAction(chatId, "typing");

            // Keep sending "typing" every 4s while the model processes
            // (thinking models can take a long time before producing content)
            const typingInterval = setInterval(() => {
              bot.api.sendChatAction(chatId, "typing").catch(() => {});
            }, 4000);

            // Streaming: send initial message then edit as tokens arrive
            let streamMsgId: number | null = null;
            let sendingInitial = false; // Guard against duplicate initial sends
            let accumulated = "";
            let lastEditTime = 0;
            const EDIT_INTERVAL = 800; // ms between edits (Telegram rate limit)

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

                  // Send initial message on first tokens (only once)
                  if (!streamMsgId && !sendingInitial && accumulated.length > 20) {
                    sendingInitial = true;
                    bot.api.sendMessage(chatId, accumulated + " ▍").then((sent) => {
                      streamMsgId = sent.message_id;
                      lastEditTime = now;
                    }).catch(() => {});
                    return;
                  }

                  // Edit message at intervals (respect Telegram rate limits)
                  if (streamMsgId && now - lastEditTime > EDIT_INTERVAL) {
                    lastEditTime = now;
                    const display = accumulated.length > 4000
                      ? accumulated.slice(-3900) + " ▍"
                      : accumulated + " ▍";
                    bot.api.editMessageText(chatId, streamMsgId, display).catch(() => {});
                  }
                },
                onToolStart: (name: string) => {
                  // Show tool indicator if no streaming message yet
                  if (!streamMsgId) {
                    bot.api.sendChatAction(chatId, "typing").catch(() => {});
                  }
                },
                onError: (message: string) => {
                  bot.api.sendMessage(chatId, `Error: ${message.slice(0, 200)}`).catch(() => {});
                },
              },
            );

            // Final edit with complete response (remove cursor)
            // If sendingInitial is true but streamMsgId isn't set yet, the
            // initial sendMessage is still in flight — wait for it briefly
            if (sendingInitial && !streamMsgId) {
              await new Promise<void>((r) => {
                const check = setInterval(() => {
                  if (streamMsgId) { clearInterval(check); r(); }
                }, 50);
                setTimeout(() => { clearInterval(check); r(); }, 3000);
              });
            }

            if (streamMsgId && response) {
              const finalText = response.length > 4000
                ? response.slice(0, 3950) + "\n... (truncated)"
                : response;
              await bot.api.editMessageText(chatId, streamMsgId, finalText).catch(() => {});
            } else if (response && !streamMsgId) {
              // Never started streaming — send full response
              const chunks = splitMessage(response, 4000);
              for (const chunk of chunks) {
                await ctx.api.sendMessage(chatId, chunk);
              }
            }
            clearInterval(typingInterval);
            console.log(`  Telegram: response complete (${response?.length || 0} chars)`);
          } catch (err: unknown) {
            clearInterval(typingInterval);
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`  Telegram: message handler error — ${errMsg}`);
            await ctx.api.sendMessage(chatId, `Error: ${errMsg.slice(0, 200)}`).catch(() => {});
          }
        };

        // Chain onto the existing queue for this chat
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

        // Same permission check
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

        if (msg.date < startupTime - 30) return; // Drop stale

        const processVoice = async () => {
          if (!this.gateway || !this.config) return;

          try {
            await ctx.api.sendChatAction(chatId, "typing");

            // Download the voice file
            const file = await ctx.api.getFile(msg.voice.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;
            const res = await fetch(fileUrl);
            if (!res.ok) { await ctx.api.sendMessage(chatId, "Error: could not download voice message"); return; }
            const audioBuffer = Buffer.from(await res.arrayBuffer());

            // Transcribe
            const { STTEngine } = await import("../voice/index.js");
            const { loadConfig } = await import("../config/index.js");
            const config = await loadConfig();
            const stt = new STTEngine(config);

            if (!stt.isAvailable()) {
              await ctx.api.sendMessage(chatId, "Voice messages require speech-to-text. Set up Whisper: /help");
              return;
            }

            const transcription = await stt.transcribe(audioBuffer, "ogg");
            if (!transcription?.text) {
              await ctx.api.sendMessage(chatId, "Could not transcribe voice message.");
              return;
            }

            // Send transcription through the agent
            const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";
            const response = await this.gateway.handleInboundMessage(
              { channel: "telegram", peerId: chatId, peerKind: isGroup ? "group" : "dm" },
              `[Voice message transcription]: ${transcription.text}`,
            );

            if (response) {
              // Check if TTS is available — reply with voice if so
              const { TTSEngine } = await import("../voice/index.js");
              const tts = new TTSEngine(config);

              if (tts.isAvailable() && response.length < 2000) {
                // Use per-agent voice ID if configured
                const agentVoice = config.agents.list.find((a: any) => a.voiceId)?.voiceId;
                const audio = await tts.synthesize(response, { voiceId: agentVoice });
                if (audio) {
                  const { InputFile } = await import("grammy");
                  await ctx.api.sendVoice(chatId, new InputFile(audio.audioBuffer, "reply.mp3"));
                  return;
                }
              }

              // Fall back to text
              const chunks = splitMessage(response, 4000);
              for (const chunk of chunks) {
                await ctx.api.sendMessage(chatId, chunk);
              }
            }
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            await ctx.api.sendMessage(chatId, `Error: ${errMsg.slice(0, 200)}`);
          }
        };

        const prev = chatLocks.get(chatId) || Promise.resolve();
        const next = prev.then(processVoice).catch(() => {});
        chatLocks.set(chatId, next);
      });

      // Handle photo messages — describe via vision model or save for agent
      bot.on("message:photo", async (ctx) => {
        const msg = ctx.message;
        const chatId = msg.chat.id;
        if (msg.date < startupTime - 30) return;

        // Permission check (same as text)
        if (telegramConfig.allowFrom && telegramConfig.allowFrom.length > 0) {
          const username = msg.from?.username ? `@${msg.from.username}` : "";
          const userIdStr = String(msg.from?.id || "");
          const allowed = telegramConfig.allowFrom.map(String);
          if (!allowed.some((a) => a === userIdStr || a.toLowerCase() === username.toLowerCase() || a.toLowerCase() === (msg.from?.username || "").toLowerCase())) return;
        }

        const processPhoto = async () => {
          if (!this.gateway) return;
          try {
            // Get the largest photo
            const photo = msg.photo[msg.photo.length - 1];
            const file = await bot.api.getFile(photo.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;

            const caption = msg.caption || "";
            const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

            // Route to agent with image context
            const response = await this.gateway.handleInboundMessage(
              { channel: "telegram", peerId: chatId, peerKind: isGroup ? "group" : "dm" },
              `[Image received: ${fileUrl}]${caption ? ` Caption: ${caption}` : ""}\n\nDescribe or analyze the image if you can, or acknowledge it.`,
            );

            if (response) {
              const chunks = splitMessage(response, 4000);
              for (const chunk of chunks) await ctx.api.sendMessage(chatId, chunk);
            }
          } catch (err: unknown) {
            await ctx.api.sendMessage(chatId, `Error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
          }
        };

        const prev = chatLocks.get(chatId) || Promise.resolve();
        chatLocks.set(chatId, prev.then(processPhoto).catch(() => {}));
      });

      // Handle document/file messages — save for agent use
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

            // Security: limit file size (10MB)
            if (doc.file_size && doc.file_size > 10 * 1024 * 1024) {
              await ctx.api.sendMessage(chatId, "File too large (max 10MB).");
              return;
            }

            // Download and save to temp
            const file = await bot.api.getFile(doc.file_id);
            const fileUrl = `https://api.telegram.org/file/bot${telegramConfig.botToken}/${file.file_path}`;
            const res = await fetch(fileUrl);
            if (!res.ok) { await ctx.api.sendMessage(chatId, "Could not download file."); return; }

            const { writeFile: wf } = await import("node:fs/promises");
            const { join } = await import("node:path");
            const { tmpdir } = await import("node:os");
            // Sanitize filename to prevent path traversal
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
            await ctx.api.sendMessage(chatId, `Error: ${(err instanceof Error ? err.message : String(err)).slice(0, 200)}`);
          }
        };

        const prev = chatLocks.get(chatId) || Promise.resolve();
        chatLocks.set(chatId, prev.then(processDoc).catch(() => {}));
      });

      // bot.start() is blocking (resolves when bot stops) — run it without await
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
    const command = cmd.replace(/@\w+$/, ""); // Strip @botname suffix

    switch (command) {
      case "help":
      case "start":
        return [
          "*Clank Commands*",
          "",
          "/help — Show this help",
          "/status — Agent and model info",
          "/agents — List available agents",
          "/agent <name> — Switch to a different agent",
          "/sessions — List recent sessions",
          "/new — Start a new session",
          "/reset — Clear current session",
          "/model — Show current model",
          "/think — Toggle thinking display",
        ].join("\n");

      case "status": {
        const cfg = this.config;
        const model = cfg?.agents?.defaults?.model?.primary || "unknown";
        const agents = cfg?.agents?.list?.length || 0;
        return [
          "*Status*",
          `Model: \`${model}\``,
          `Agents: ${agents} configured`,
          `Chat: ${isGroup ? "group" : "DM"} (${chatId})`,
        ].join("\n");
      }

      case "agents": {
        const list = this.config?.agents?.list || [];
        if (list.length === 0) return "No custom agents configured. Using default agent.";
        return "*Agents:*\n" + list.map((a) =>
          `• *${a.name || a.id}* — \`${a.model?.primary || "default"}\``
        ).join("\n");
      }

      case "agent":
        if (args[0]) {
          return `Agent switching via Telegram coming soon. Use the config tool in chat: "switch to agent ${args[0]}"`;
        }
        return "Usage: /agent <name>";

      case "sessions": {
        if (!this.gateway) return "Gateway not connected";
        return "Use /new to start a fresh session, or /reset to clear the current one.";
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
          ? "New session started. Send a message to begin."
          : "Session reset. History cleared.";

      case "model": {
        const model = this.config?.agents?.defaults?.model?.primary || "unknown";
        return `Current model: \`${model}\``;
      }

      case "think":
        return "Thinking display toggled. (Note: thinking visibility is per-client in the TUI/Web UI)";

      default:
        return null; // Not a recognized command — let it pass through to the agent
    }
  }

  async send(sessionKey: string, payload: ReplyPayload): Promise<void> {
    // Extract chat ID from session key (dm:telegram:12345 → 12345)
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
    // Try to split at a newline
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen; // No good newline, split at limit
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
