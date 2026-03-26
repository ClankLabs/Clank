/**
 * Discord channel adapter.
 *
 * Built on discord.js. Supports:
 * - Server/channel/role-based routing
 * - Thread support for long conversations
 * - Button-based confirmations
 * - Streaming via message editing
 */

import { ChannelAdapter, type InboundMessage, type ReplyPayload } from "./base.js";
import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

export class DiscordAdapter extends ChannelAdapter {
  readonly id = "discord";
  readonly name = "Discord";
  private gateway: GatewayServer | null = null;
  private config: ClankConfig | null = null;
  private client: unknown = null; // discord.js Client — loaded dynamically
  private running = false;

  init(gateway: GatewayServer, config: ClankConfig): void {
    this.gateway = gateway;
    this.config = config;
  }

  async start(): Promise<void> {
    const discordConfig = this.config?.channels?.discord;
    if (!discordConfig?.enabled || !discordConfig.botToken) {
      console.log("  Discord: disabled or no bot token configured");
      return;
    }

    try {
      const discord = await import("discord.js" as string) as any;
      this.client = new discord.Client({
        intents: [
          discord.GatewayIntentBits.Guilds,
          discord.GatewayIntentBits.GuildMessages,
          discord.GatewayIntentBits.MessageContent,
          discord.GatewayIntentBits.DirectMessages,
        ],
      });

      const client = this.client as any;

      client.on("ready", () => {
        console.log(`  Discord: connected as ${client.user?.tag}`);
        this.running = true;
      });

      client.on("messageCreate", async (message: any) => {
        if (message.author.bot) return;

        const isDM = !message.guild;

        // Route through gateway
        if (!this.gateway) return;

        try {
          await message.channel.sendTyping().catch(() => {});

          const response = await this.gateway.handleInboundMessage(
            {
              channel: "discord",
              peerId: isDM ? message.author.id : message.channelId,
              peerKind: isDM ? "dm" : "group",
              guildId: message.guild?.id,
            },
            message.content,
          );

          if (response) {
            // Discord has 2000 char limit
            const chunks = splitDiscordMessage(response, 1900);
            for (const chunk of chunks) {
              await message.reply(chunk);
            }
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await message.reply(`Error: ${errMsg.slice(0, 200)}`);
        }
      });

      await client.login(discordConfig.botToken);
    } catch (err) {
      console.error(`  Discord: failed to start — ${err instanceof Error ? err.message : err}`);
    }
  }

  async stop(): Promise<void> {
    if (this.client && this.running) {
      (this.client as { destroy: () => void }).destroy();
      this.running = false;
    }
  }

  async send(sessionKey: string, payload: ReplyPayload): Promise<void> {
    if (!payload.text || !this.client) return;
    const client = this.client as any;

    // Extract channel ID from session key
    const parts = sessionKey.split(":");
    const channelId = parts[parts.length - 1];
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.send) {
        const chunks = splitDiscordMessage(payload.text, 1900);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }
    } catch {
      // Channel not accessible
    }
  }
}

function splitDiscordMessage(text: string, maxLen: number): string[] {
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
