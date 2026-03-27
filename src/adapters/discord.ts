/**
 * Discord channel adapter.
 *
 * Built on discord.js. Supports:
 * - Server/channel/role-based routing
 * - Button-based tool approval confirmations
 * - Slash commands via shared handler
 */

import { ChannelAdapter, type InboundMessage, type ReplyPayload } from "./base.js";
import { handleAdapterCommand, toolEmoji, splitMessage } from "./commands.js";
import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

/** Pending tool confirmations — keyed by confirmId */
const pendingConfirms = new Map<string, (v: boolean | "always") => void>();

export class DiscordAdapter extends ChannelAdapter {
  readonly id = "discord";
  readonly name = "Discord";
  private gateway: GatewayServer | null = null;
  private config: ClankConfig | null = null;
  private client: unknown = null; // discord.js Client — loaded dynamically
  private discord: any = null;    // discord.js module reference
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
      this.discord = await import("discord.js" as string) as any;
      const discord = this.discord;

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
        if (!this.gateway) return;

        const text = message.content?.trim();
        if (!text) return;

        // Handle slash commands
        if (text.startsWith("/")) {
          const reply = await handleAdapterCommand(text, {
            gateway: this.gateway,
            config: this.config,
            channel: "discord",
            chatId: isDM ? message.author.id : message.channelId,
            isGroup: !isDM,
          });
          if (reply) {
            const chunks = splitMessage(reply, 1900);
            for (const chunk of chunks) {
              await message.reply(chunk);
            }
            return;
          }
        }

        try {
          await message.channel.sendTyping().catch(() => {});

          const response = await this.gateway.handleInboundMessageStreaming(
            {
              channel: "discord",
              peerId: isDM ? message.author.id : message.channelId,
              peerKind: isDM ? "dm" : "group",
              guildId: message.guild?.id,
            },
            text,
            {
              onError: (msg: string) => {
                message.reply(`⚠️ ${msg.slice(0, 200)}`).catch(() => {});
              },
              onConfirm: (actions: unknown[], resolve: (v: boolean | "always") => void) => {
                const action = (actions as Array<{ toolName?: string; description?: string; safetyLevel?: string }>)[0];
                const toolName = action?.toolName || "unknown tool";
                const description = action?.description || "";
                const level = action?.safetyLevel || "high";
                const confirmId = `confirm_${Date.now()}`;

                pendingConfirms.set(confirmId, resolve);

                const emoji = toolEmoji(toolName);
                const desc = description ? `\n${description}` : "";
                const row = new discord.ActionRowBuilder().addComponents(
                  new discord.ButtonBuilder()
                    .setCustomId(`${confirmId}:yes`)
                    .setLabel("Approve")
                    .setStyle(discord.ButtonStyle.Success),
                  new discord.ButtonBuilder()
                    .setCustomId(`${confirmId}:always`)
                    .setLabel("Always")
                    .setStyle(discord.ButtonStyle.Primary),
                  new discord.ButtonBuilder()
                    .setCustomId(`${confirmId}:no`)
                    .setLabel("Deny")
                    .setStyle(discord.ButtonStyle.Danger),
                );

                message.reply({
                  content: `${emoji} **Tool approval needed**\n\n\`${toolName}\` (${level} risk)${desc}\n\nApprove this action?`,
                  components: [row],
                }).catch(() => {});

                // Auto-approve after 30s
                setTimeout(() => {
                  if (pendingConfirms.has(confirmId)) {
                    pendingConfirms.delete(confirmId);
                    resolve(true);
                  }
                }, 30_000);
              },
            },
          );

          if (response) {
            const chunks = splitMessage(response, 1900);
            for (const chunk of chunks) {
              await message.reply(chunk);
            }
          }
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          await message.reply(`Error: ${errMsg.slice(0, 200)}`).catch(() => {});
        }
      });

      // Handle button clicks for tool approvals
      client.on("interactionCreate", async (interaction: any) => {
        if (!interaction.isButton()) return;

        const [confirmId, choice] = interaction.customId.split(":");
        const resolve = pendingConfirms.get(confirmId);
        if (!resolve) {
          await interaction.reply({ content: "This approval has expired.", ephemeral: true }).catch(() => {});
          return;
        }

        pendingConfirms.delete(confirmId);
        await interaction.update({
          content: choice === "no"
            ? `❌ Tool action — **denied**`
            : `✅ Tool action — **approved**`,
          components: [],
        }).catch(() => {});

        resolve(choice === "always" ? "always" : choice !== "no");
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

    const parts = sessionKey.split(":");
    const channelId = parts[parts.length - 1];
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel?.send) {
        const chunks = splitMessage(payload.text, 1900);
        for (const chunk of chunks) {
          await channel.send(chunk);
        }
      }
    } catch {
      // Channel not accessible
    }
  }
}
