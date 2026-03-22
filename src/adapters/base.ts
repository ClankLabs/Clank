/**
 * Channel adapter base interface.
 *
 * All channels (CLI, Telegram, Discord, Web, Slack, etc.) implement
 * this interface. The gateway treats them all equally — no hierarchy,
 * no "primary" interface. User picks what fits their workflow.
 *
 * The pattern is simple:
 * - Inbound: adapter receives platform message → normalizes → calls gateway.handleMessage()
 * - Outbound: gateway calls adapter.send() with a ReplyPayload
 */

import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

/** Normalized inbound message from any channel */
export interface InboundMessage {
  /** Raw text content */
  text: string;
  /** Channel identifier (telegram, discord, cli, web, etc.) */
  channel: string;
  /** Sender identifier (user ID, etc.) */
  senderId: string | number;
  /** Peer identifier (chat/group/channel ID) */
  peerId: string | number;
  /** Peer kind */
  peerKind: "dm" | "group" | "channel";
  /** Thread ID if applicable */
  threadId?: string | number;
  /** Whether the bot was explicitly mentioned */
  mentioned?: boolean;
  /** Optional media attachments */
  media?: Array<{ type: string; url: string }>;
}

/** Outbound reply to any channel */
export interface ReplyPayload {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyToId?: string;
  isError?: boolean;
}

/** The interface every channel adapter must implement */
export abstract class ChannelAdapter {
  abstract readonly id: string;
  abstract readonly name: string;

  /** Initialize the adapter with gateway and config references */
  abstract init(gateway: GatewayServer, config: ClankConfig): void;

  /** Start the adapter (connect to platform, begin polling, etc.) */
  abstract start(): Promise<void>;

  /** Stop the adapter (disconnect, cleanup) */
  abstract stop(): Promise<void>;

  /**
   * Send a reply payload to the platform.
   * Called by the gateway when an agent produces a response.
   */
  abstract send(sessionKey: string, payload: ReplyPayload): Promise<void>;

  /**
   * Send a streaming token to the platform.
   * Used for real-time response streaming (e.g., editing a Telegram message).
   */
  async sendToken?(sessionKey: string, content: string): Promise<void> {
    // Default: no streaming support, full response sent via send()
  }
}
