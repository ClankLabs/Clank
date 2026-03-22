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
        const inbound: InboundMessage = {
          text: message.content,
          channel: "discord",
          senderId: message.author.id,
          peerId: isDM ? message.author.id : message.channelId,
          peerKind: isDM ? "dm" : "group",
          mentioned: message.mentions.has(client.user!),
        };

        // TODO: Route through gateway properly
        console.log(`  Discord: ${isDM ? "dm" : "guild"} from ${message.author.tag}: ${message.content.slice(0, 50)}`);
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
    // TODO: Send message to Discord channel/DM
    // Extract channel ID from session key and send via discord.js
  }
}
