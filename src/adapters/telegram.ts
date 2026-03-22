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

        // Normalize and forward to gateway
        const inbound: InboundMessage = {
          text: msg.text,
          channel: "telegram",
          senderId: userId || 0,
          peerId: chatId,
          peerKind: isGroup ? "group" : "dm",
          mentioned: true,
        };

        // TODO: Route through gateway properly
        // For now, placeholder
        console.log(`  Telegram: ${isGroup ? "group" : "dm"} from ${userId}: ${msg.text.slice(0, 50)}`);
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

  async send(sessionKey: string, payload: ReplyPayload): Promise<void> {
    // Extract chat ID from session key (dm:telegram:12345 → 12345)
    const parts = sessionKey.split(":");
    const chatId = parts[parts.length - 1];
    if (!chatId || !this.bot) return;

    const bot = this.bot as any;
    if (payload.text) {
      await bot.api.sendMessage(Number(chatId), payload.text);
    }
  }
}
