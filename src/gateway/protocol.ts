/**
 * Gateway WebSocket protocol v1.
 *
 * All UIs (Web, TUI, CLI, Desktop) use this same protocol.
 * JSON text frames over WebSocket. The gateway is the brain —
 * every frontend is a thin client.
 */

// === Frame Types ===

/** Client → Server: connection handshake */
export interface ConnectParams {
  type: "connect";
  params: {
    auth: { token?: string; pin?: string };
    mode: "tui" | "web" | "cli" | "desktop";
    version: string;
  };
}

/** Server → Client: handshake response */
export interface HelloFrame {
  type: "hello";
  protocol: number;
  version: string;
  agents: Array<{ id: string; name: string; model: string; status: string }>;
  sessions: Array<{ key: string; label?: string; agentId: string; updatedAt: number }>;
}

/** Client → Server: RPC request */
export interface RequestFrame {
  type: "req";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

/** Server → Client: RPC response */
export interface ResponseFrame {
  type: "res";
  id: string | number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

/** Server → Client: push event */
export interface EventFrame {
  type: "event";
  event: string;
  payload: unknown;
  seq: number;
}

export type Frame = ConnectParams | HelloFrame | RequestFrame | ResponseFrame | EventFrame;

/** Protocol version */
export const PROTOCOL_VERSION = 1;

/** Default gateway port */
export const DEFAULT_PORT = 18789;

// === RPC Methods ===

export const METHODS = {
  // Chat
  CHAT_SEND: "chat.send",
  CHAT_HISTORY: "chat.history",
  CHAT_ABORT: "chat.abort",

  // Sessions
  SESSION_LIST: "session.list",
  SESSION_DELETE: "session.delete",
  SESSION_RESET: "session.reset",

  // Agents
  AGENT_LIST: "agent.list",
  AGENT_STATUS: "agent.status",

  // Config
  CONFIG_GET: "config.get",
  CONFIG_SET: "config.set",

  // Pipelines
  PIPELINE_LIST: "pipeline.list",
  PIPELINE_RUN: "pipeline.run",
  PIPELINE_STATUS: "pipeline.status",
  PIPELINE_ABORT: "pipeline.abort",

  // Cron
  CRON_LIST: "cron.list",
  CRON_CREATE: "cron.create",
  CRON_DELETE: "cron.delete",
  CRON_TRIGGER: "cron.trigger",

  // Logs
  LOG_TAIL: "log.tail",
  LOG_QUERY: "log.query",

  // Legacy compat
  CONNECT: "connect",
  SEND_MESSAGE: "sendMessage",
  CANCEL: "cancel",
} as const;

// === Event Types ===

export const EVENTS = {
  // Chat events
  CHAT_STREAM: "chat.stream",
  CHAT_TOOL: "chat.tool",
  CHAT_THINKING: "chat.thinking",
  CHAT_COMPLETE: "chat.complete",
  CHAT_ERROR: "chat.error",

  // System events
  PIPELINE_STEP: "pipeline.step",
  PIPELINE_COMPLETE: "pipeline.complete",
  AGENT_STATUS: "agent.status",
  CHANNEL_STATUS: "channel.status",
  LOG_ENTRY: "log.entry",

  // Legacy compat
  TOKEN: "token",
  RESPONSE_START: "response-start",
  RESPONSE_END: "response-end",
  TOOL_START: "tool-start",
  TOOL_RESULT: "tool-result",
  CONFIRM_NEEDED: "confirm-needed",
  CONTEXT_COMPACTING: "context-compacting",
  USAGE: "usage",
  ERROR: "error",
  TURN_COMPLETE: "turn-complete",
} as const;

// === Helpers ===

export function parseFrame(data: string): Frame | null {
  try {
    return JSON.parse(data) as Frame;
  } catch {
    return null;
  }
}

export function serializeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}
