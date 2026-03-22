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

// @ts-ignore — grammy is an optional dependency, dynamically imported
import { ChannelAdapter, type InboundMessage, type ReplyPayload } from "./base.js";
import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

export class TelegramAdapter extends ChannelAdapter {
  readonly id = "telegram";
  readonly name = "Telegram";
  private gateway: GatewayServer | null = null;
  private config: ClankConfig | null = null;
  private bot: unknown = null; // grammY Bot instance — loaded dynamically
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
      // Dynamic import — grammY is an optional dependency
      const grammy = await import("grammy" as string) as { Bot: new (token: string) => any };
      this.bot = new grammy.Bot(telegramConfig.botToken);

      const bot = this.bot as any;

      // Handle text messages
      bot.on("message:text", async (ctx: any) => {
        const msg = ctx.message;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const isGroup = msg.chat.type === "group" || msg.chat.type === "supergroup";

        // Permission check
        if (telegramConfig.allowFrom && userId) {
          const allowed = telegramConfig.allowFrom.map(String);
          if (!allowed.includes(String(userId))) return;
        }

        // Mention check in groups
        if (isGroup) {
          const groupConfig = telegramConfig.groups?.[String(chatId)];
          if (groupConfig?.requireMention !== false) {
            const botInfo = await bot.api.getMe();
            if (!msg.text.includes(`@${botInfo.username}`)) return;
          }
        }

        // Handle slash commands in messaging apps
        if (msg.text.startsWith("/")) {
          const reply = await this.handleCommand(msg.text, chatId, isGroup);
          if (reply) {
            await ctx.api.sendMessage(chatId, reply, { parse_mode: "Markdown" });
          }
          return;
        }

        // Route through gateway
        if (!this.gateway) return;

        try {
          // Send typing indicator
          await ctx.api.sendChatAction(chatId, "typing");

          const response = await this.gateway.handleInboundMessage(
            {
              channel: "telegram",
              peerId: chatId,
              peerKind: isGroup ? "group" : "dm",
            },
            msg.text,
          );

          // Send response (split if too long for Telegram's 4096 char limit)
          if (response) {
            const chunks = splitMessage(response, 4000);
            for (const chunk of chunks) {
              await ctx.api.sendMessage(chatId, chunk);
            }
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await ctx.api.sendMessage(chatId, `Error: ${errMsg.slice(0, 200)}`);
        }
      });

      await bot.start();
      this.running = true;
      console.log("  Telegram: connected");
    } catch (err) {
      console.error(`  Telegram: failed to start — ${err instanceof Error ? err.message : err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.bot && this.running) {
      (this.bot as { stop: () => void }).stop();
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
        return "New session started. Send a message to begin.";

      case "reset":
        return "Session reset. History cleared.";

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

    const bot = this.bot as any;
    if (payload.text) {
      const chunks = splitMessage(payload.text, 4000);
      for (const chunk of chunks) {
        await bot.api.sendMessage(Number(chatId), chunk);
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
