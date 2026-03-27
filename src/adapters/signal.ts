/**
 * Signal channel adapter.
 *
 * Communicates with signal-cli daemon via HTTP JSON-RPC.
 * User must install and run signal-cli separately:
 *   signal-cli -a +PHONE daemon --http localhost:7583
 *
 * Zero npm dependencies — uses native fetch().
 */

import { ChannelAdapter, type ReplyPayload } from "./base.js";
import { handleAdapterCommand, toolEmoji, splitMessage } from "./commands.js";
import type { GatewayServer } from "../gateway/server.js";
import type { ClankConfig } from "../config/index.js";

// ── JSON-RPC client for signal-cli ──────────────────────────────────

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface SignalEnvelope {
  source?: string;                    // Sender phone number
  sourceNumber?: string;
  sourceName?: string;
  timestamp?: number;
  dataMessage?: {
    message?: string;
    timestamp?: number;
    groupInfo?: { groupId: string; type?: string };
    attachments?: Array<{
      contentType: string;
      filename?: string;
      id: string;
      size?: number;
    }>;
  };
  syncMessage?: {
    sentMessage?: {
      message?: string;
      destination?: string;
      groupInfo?: { groupId: string };
    };
  };
}

let rpcId = 0;

async function rpcCall(endpoint: string, method: string, params: Record<string, unknown> = {}, signal?: AbortSignal): Promise<unknown> {
  const body = JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params });
  const res = await fetch(`${endpoint}/api/v1/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal,
  });
  if (!res.ok) throw new Error(`signal-cli HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json() as JsonRpcResponse;
  if (json.error) throw new Error(`signal-cli RPC: ${json.error.message}`);
  return json.result;
}

// ── Signal Adapter ──────────────────────────────────────────────────

export class SignalAdapter extends ChannelAdapter {
  readonly id = "signal";
  readonly name = "Signal";

  private gateway: GatewayServer | null = null;
  private config: ClankConfig | null = null;
  private endpoint = "http://localhost:7583";
  private account: string | undefined;
  private running = false;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private chatLocks = new Map<string, Promise<void>>();

  init(gateway: GatewayServer, config: ClankConfig): void {
    this.gateway = gateway;
    this.config = config;
  }

  async start(): Promise<void> {
    const signalConfig = (this.config?.channels as Record<string, unknown>)?.signal as {
      enabled?: boolean;
      endpoint?: string;
      account?: string;
      allowFrom?: string[];
      groups?: Record<string, { requireMention?: boolean }>;
    } | undefined;

    if (!signalConfig?.enabled) {
      console.log("  Signal: disabled");
      return;
    }

    if (signalConfig.endpoint) this.endpoint = signalConfig.endpoint;
    this.account = signalConfig.account;

    // Verify signal-cli daemon is reachable
    try {
      await rpcCall(this.endpoint, "listAccounts", {});
    } catch {
      console.log("  Signal: signal-cli daemon not reachable at " + this.endpoint);
      console.log("  Signal: start it with: signal-cli daemon --http " + this.endpoint.replace("http://", ""));
      return;
    }

    this.running = true;

    // Poll for messages every 1 second
    this.pollTimer = setInterval(() => this.poll().catch(() => {}), 1000);
    console.log("  Signal: connected via " + this.endpoint);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async send(sessionKey: string, payload: ReplyPayload): Promise<void> {
    if (!payload.text) return;

    const parts = sessionKey.split(":");
    const peerId = parts[parts.length - 1];
    const isGroup = sessionKey.startsWith("group:");

    const chunks = splitMessage(payload.text, 4000);
    for (const chunk of chunks) {
      try {
        if (isGroup) {
          await rpcCall(this.endpoint, "send", {
            ...(this.account ? { account: this.account } : {}),
            groupId: peerId,
            message: chunk,
          });
        } else {
          await rpcCall(this.endpoint, "send", {
            ...(this.account ? { account: this.account } : {}),
            recipient: [peerId],
            message: chunk,
          });
        }
      } catch (err) {
        console.error(`  Signal: send error — ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // ── Private methods ─────────────────────────────────────────────

  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      const result = await rpcCall(this.endpoint, "receive", {
        ...(this.account ? { account: this.account } : {}),
      });

      const envelopes = Array.isArray(result) ? result as SignalEnvelope[] : [];
      for (const env of envelopes) {
        this.handleEnvelope(env).catch((err) => {
          console.error(`  Signal: message error — ${err instanceof Error ? err.message : err}`);
        });
      }
    } catch {
      // Daemon may be temporarily unavailable — silently retry next tick
    }
  }

  private async handleEnvelope(env: SignalEnvelope): Promise<void> {
    const sender = env.source || env.sourceNumber;
    const data = env.dataMessage;
    if (!sender || !data?.message) return;

    // Skip sync messages (messages we sent ourselves)
    if (env.syncMessage) return;

    const text = data.message.trim();
    if (!text) return;

    const isGroup = !!data.groupInfo?.groupId;
    const chatId = isGroup ? data.groupInfo!.groupId : sender;

    // Permission check
    const signalConfig = (this.config?.channels as Record<string, unknown>)?.signal as {
      allowFrom?: string[];
      groups?: Record<string, { requireMention?: boolean }>;
    } | undefined;

    if (signalConfig?.allowFrom && signalConfig.allowFrom.length > 0) {
      const allowed = signalConfig.allowFrom.map(String);
      if (!allowed.some((a) => a === sender)) return;
    }

    // Group mention requirement — check if bot's account number is mentioned
    if (isGroup && this.account) {
      const groupConfig = signalConfig?.groups?.[data.groupInfo!.groupId];
      if (groupConfig?.requireMention !== false) {
        if (!text.includes(this.account)) return;
      }
    }

    // Per-chat message queue
    const prev = this.chatLocks.get(chatId) || Promise.resolve();
    const next = prev.then(() => this.processMessage(text, sender, chatId, isGroup)).catch((err) => {
      console.error(`  Signal: queue error — ${err instanceof Error ? err.message : err}`);
    });
    this.chatLocks.set(chatId, next);
  }

  private async processMessage(text: string, _sender: string, chatId: string, isGroup: boolean): Promise<void> {
    if (!this.gateway) return;

    // Handle slash commands
    if (text.startsWith("/")) {
      const reply = await this.handleCommand(text, chatId, isGroup);
      if (reply) {
        await this.sendText(chatId, isGroup, reply);
      }
      return;
    }

    // Send to gateway (non-streaming — Signal can't edit messages)
    try {
      const context = {
        channel: "signal" as const,
        peerId: chatId,
        peerKind: (isGroup ? "group" : "dm") as "dm" | "group",
      };

      // Use streaming callbacks for tool indicators even though we send full response
      const toolIndicators: Array<{ name: string; done?: boolean }> = [];

      const response = await this.gateway.handleInboundMessageStreaming(
        context,
        text,
        {
          onToolStart: (name: string) => {
            toolIndicators.push({ name });
          },
          onToolResult: (name: string, success: boolean) => {
            const tool = toolIndicators.find((t) => t.name === name && !t.done);
            if (tool) tool.done = success;
          },
          onError: (message: string) => {
            this.sendText(chatId, isGroup, `⚠️ ${message.slice(0, 200)}`).catch(() => {});
          },
        },
      );

      if (response) {
        // Prepend tool summary if tools were used
        let finalText = response;
        if (toolIndicators.length > 0) {
          const toolLine = toolIndicators
            .map((t) => `${toolEmoji(t.name)} ${t.name}${t.done === false ? " ✗" : ""}`)
            .join("  ");
          finalText = toolLine + "\n\n" + response;
        }
        await this.sendText(chatId, isGroup, finalText);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Rate limited")) {
        await this.sendText(chatId, isGroup, "⏳ Too many messages — wait a moment.");
      } else {
        console.error(`  Signal: agent error — ${msg}`);
      }
    }
  }

  private async sendText(chatId: string, isGroup: boolean, text: string): Promise<void> {
    const chunks = splitMessage(text, 4000);
    for (const chunk of chunks) {
      try {
        if (isGroup) {
          await rpcCall(this.endpoint, "send", {
            ...(this.account ? { account: this.account } : {}),
            groupId: chatId,
            message: chunk,
          });
        } else {
          await rpcCall(this.endpoint, "send", {
            ...(this.account ? { account: this.account } : {}),
            recipient: [chatId],
            message: chunk,
          });
        }
      } catch (err) {
        console.error(`  Signal: send error — ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // ── Slash commands ──────────────────────────────────────────────

  private async handleCommand(text: string, chatId: string, isGroup: boolean): Promise<string | null> {
    return handleAdapterCommand(text, {
      gateway: this.gateway,
      config: this.config,
      channel: "signal",
      chatId,
      isGroup,
    });
  }
}
