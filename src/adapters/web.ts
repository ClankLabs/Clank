/**
 * Web UI channel adapter.
 *
 * The Web UI is served as a React/Preact SPA from the gateway at /chat.
 * It connects via WebSocket (same protocol as CLI). This adapter handles
 * the server-side of that connection.
 *
 * The actual SPA will be built in src/web/ — this adapter just serves
 * the static files and manages WebSocket connections for web clients.
 */

import { ChannelAdapter, type ReplyPayload } from "./base.js";
import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

export class WebAdapter extends ChannelAdapter {
  readonly id = "web";
  readonly name = "Web UI";
  private gateway: GatewayServer | null = null;
  private config: ClankConfig | null = null;

  init(gateway: GatewayServer, config: ClankConfig): void {
    this.gateway = gateway;
    this.config = config;
  }

  async start(): Promise<void> {
    const webConfig = this.config?.channels?.web;
    if (!webConfig?.enabled) {
      console.log("  Web UI: disabled");
      return;
    }

    // Web UI clients connect via the same WebSocket as CLI clients.
    // The gateway server already handles WebSocket connections.
    // This adapter just registers itself for the /chat HTTP route.
    console.log("  Web UI: enabled (served at /chat)");
  }

  async stop(): Promise<void> {
    // Nothing to clean up — WebSocket connections managed by gateway
  }

  async send(_sessionKey: string, _payload: ReplyPayload): Promise<void> {
    // Web UI clients receive messages via WebSocket events,
    // handled by the gateway server's event bridging.
    // No separate send needed.
  }
}
