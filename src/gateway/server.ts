/**
 * Gateway server — the central daemon.
 *
 * This is what makes Clank a platform instead of a CLI tool.
 * The gateway is an HTTP + WebSocket server that:
 * - Accepts client connections (CLI, Web, Telegram, Discord)
 * - Routes messages to agent instances
 * - Streams responses back via events
 * - Serves the Web UI static files
 * - Provides a health endpoint
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AgentEngine, type AgentIdentity, buildSystemPrompt } from "../engine/index.js";
import { createFullRegistry, type ToolRegistry } from "../tools/index.js";
import { createProvider, resolveWithFallback, type ProviderConfig } from "../providers/index.js";
import { SessionStore } from "../sessions/index.js";
import { MemoryManager } from "../memory/index.js";
import { type ClankConfig, getConfigDir, ConfigWatcher } from "../config/index.js";
import { CronScheduler } from "../cron/index.js";
import { TaskRegistry } from "../tasks/index.js";
import { AuthProfileStore } from "../auth/index.js";
import { resolveRoute, deriveSessionKey, type RouteContext } from "../routing/index.js";
import { type ChannelAdapter } from "../adapters/base.js";
import { TelegramAdapter } from "../adapters/telegram.js";
import { DiscordAdapter } from "../adapters/discord.js";
import { SignalAdapter } from "../adapters/signal.js";
import { WebAdapter } from "../adapters/web.js";
import { PluginLoader } from "../plugins/index.js";
import {
  type Frame,
  type RequestFrame,
  type ResponseFrame,
  type EventFrame,
  type ConnectParams,
  type HelloFrame,
  parseFrame,
  serializeFrame,
  PROTOCOL_VERSION,
  DEFAULT_PORT,
} from "./protocol.js";

interface ClientConnection {
  ws: WebSocket;
  clientName: string;
  sessionKey: string;
  agentId: string;
  authenticated: boolean;
  eventSeq: number;
}

export class GatewayServer {
  private config: ClankConfig;
  private httpServer: ReturnType<typeof createServer> | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Map<WebSocket, ClientConnection>();
  private engines = new Map<string, AgentEngine>();
  private sessionStore: SessionStore;
  private toolRegistry: ToolRegistry;
  private memoryManager: MemoryManager;
  private cronScheduler: CronScheduler;
  private configWatcher: ConfigWatcher;
  private pluginLoader: PluginLoader;
  private taskRegistry: TaskRegistry;
  private authProfileStore: AuthProfileStore;
  private adapters: ChannelAdapter[] = [];
  private running = false;
  /** Rate limiting: track message timestamps per session */
  private rateLimiter = new Map<string, number[]>();
  private readonly RATE_LIMIT_WINDOW = 60_000; // 1 minute
  private readonly RATE_LIMIT_MAX = 20; // max 20 messages per minute per session

  constructor(config: ClankConfig) {
    this.config = config;
    this.sessionStore = new SessionStore(join(getConfigDir(), "conversations"));
    this.toolRegistry = createFullRegistry();
    this.memoryManager = new MemoryManager(join(getConfigDir(), "memory"));
    this.cronScheduler = new CronScheduler(join(getConfigDir(), "cron"));
    this.configWatcher = new ConfigWatcher();
    this.pluginLoader = new PluginLoader();
    this.taskRegistry = new TaskRegistry();
    this.authProfileStore = new AuthProfileStore();
  }

  /** Get the task registry (for adapters to list tasks) */
  getTaskRegistry(): TaskRegistry {
    return this.taskRegistry;
  }

  /** Start the gateway server */
  async start(): Promise<void> {
    // Catch unhandled rejections so the gateway logs errors instead of dying silently
    process.on("unhandledRejection", (err) => {
      console.error(`  Unhandled rejection: ${err instanceof Error ? err.message : err}`);
    });

    // Ensure auth token exists — generate one if missing
    if (this.config.gateway.auth.mode === "token" && !this.config.gateway.auth.token) {
      const { randomBytes } = await import("node:crypto");
      this.config.gateway.auth.token = randomBytes(16).toString("hex");
      console.log(`  Generated auth token: ${this.config.gateway.auth.token.slice(0, 8)}...`);
    }

    // Initialize subsystems
    await this.sessionStore.init();
    await this.memoryManager.init();
    await this.cronScheduler.init();
    this.taskRegistry.start();

    // Load plugins and register their tools
    const plugins = await this.pluginLoader.loadAll();
    for (const tool of this.pluginLoader.getTools()) {
      this.toolRegistry.register(tool);
    }
    if (plugins.length > 0) {
      console.log(`  Loaded ${plugins.length} plugin(s), ${this.pluginLoader.getTools().length} tool(s)`);
    }

    // Start config watcher for hot-reload
    await this.configWatcher.start();
    this.configWatcher.on("change", ({ newConfig }: { newConfig: ClankConfig }) => {
      this.config = newConfig;
      console.log("  Config reloaded");
    });

    // Start cron scheduler
    this.cronScheduler.setHandler(async (job) => {
      console.log(`  Cron: running job "${job.name}"`);
      const engine = await this.getOrCreateEngine(`cron:${job.id}`, job.agentId, "cron");
      await engine.sendMessage(job.prompt);
    });
    this.cronScheduler.start();

    // Start channel adapters
    await this.startAdapters();

    const port = this.config.gateway.port || DEFAULT_PORT;
    const bind = this.config.gateway.bind === "loopback" ? "127.0.0.1" : "0.0.0.0";

    // Create HTTP server for health checks and static files
    this.httpServer = createServer((req, res) => this.handleHttp(req, res));

    // Create WebSocket server
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.wss.on("connection", (ws) => this.handleConnection(ws));

    return new Promise((resolve, reject) => {
      this.httpServer!.listen(port, bind, () => {
        this.running = true;
        console.log(`Clank Gateway running on ${bind}:${port}`);
        resolve();
      });
      this.httpServer!.on("error", reject);
    });
  }

  /** Start all configured channel adapters */
  private async startAdapters(): Promise<void> {
    console.log("  Starting channel adapters...");

    const adapterClasses: ChannelAdapter[] = [
      new TelegramAdapter(),
      new DiscordAdapter(),
      new SignalAdapter(),
      new WebAdapter(),
    ];

    for (const adapter of adapterClasses) {
      adapter.init(this, this.config);
      try {
        await adapter.start();
        this.adapters.push(adapter);
      } catch (err) {
        console.error(`  ${adapter.name}: failed — ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  /**
   * Reset a session — clear its history and context.
   * Used by channel adapters (Telegram /new, /reset commands).
   */
  async resetSession(context: RouteContext): Promise<void> {
    const sessionKey = deriveSessionKey(context);
    await this.sessionStore.reset(sessionKey);
    const engine = this.engines.get(sessionKey);
    if (engine) {
      engine.getContextEngine().clear();
      engine.destroy();
      this.engines.delete(sessionKey);
    }
  }

  /**
   * Compact a session — summarize state, clear context, inject summary.
   * Used by channel adapters (Telegram /compact command).
   * Returns the summary text, or null if no active session.
   */
  async compactSession(context: RouteContext): Promise<string | null> {
    const sessionKey = deriveSessionKey(context);
    const engine = this.engines.get(sessionKey);
    if (!engine) return null;
    return engine.compactSession();
  }

  /**
   * Handle an inbound message from any channel adapter.
   * This is the main entry point for all non-WebSocket messages.
   */
  async handleInboundMessage(context: RouteContext, text: string): Promise<string> {
    // Rate limit check
    const rlKey = deriveSessionKey(context);
    if (this.isRateLimited(rlKey)) {
      throw new Error("Rate limited — too many messages. Wait a moment.");
    }

    // Resolve which agent handles this message
    const agentId = resolveRoute(
      context,
      [], // TODO: load bindings from config
      this.config.agents.list.map((a) => ({ id: a.id, name: a.name })),
      this.config.agents.list[0]?.id || "default",
    );

    const sessionKey = deriveSessionKey(context);
    const engine = await this.getOrCreateEngine(sessionKey, agentId, context.channel);
    return engine.sendMessage(text);
  }

  /**
   * Handle an inbound message with streaming callbacks.
   * Used by channel adapters for real-time streaming (e.g., Telegram message editing).
   */
  async handleInboundMessageStreaming(
    context: RouteContext,
    text: string,
    callbacks: {
      onToken?: (content: string) => void;
      onThinking?: (content: string) => void;
      onToolStart?: (name: string) => void;
      onToolResult?: (name: string, success: boolean) => void;
      onError?: (message: string) => void;
      onConfirm?: (actions: unknown[], resolve: (v: boolean | "always") => void) => void;
    },
  ): Promise<string> {
    const rlKey = deriveSessionKey(context);
    if (this.isRateLimited(rlKey)) {
      throw new Error("Rate limited — too many messages. Wait a moment.");
    }

    return this._handleInboundMessageStreamingInner(context, text, callbacks);
  }

  private async _handleInboundMessageStreamingInner(
    context: RouteContext,
    text: string,
    callbacks: {
      onToken?: (content: string) => void;
      onThinking?: (content: string) => void;
      onToolStart?: (name: string) => void;
      onToolResult?: (name: string, success: boolean) => void;
      onError?: (message: string) => void;
      onConfirm?: (actions: unknown[], resolve: (v: boolean | "always") => void) => void;
    },
  ): Promise<string> {
    const agentId = resolveRoute(
      context,
      [],
      this.config.agents.list.map((a) => ({ id: a.id, name: a.name })),
      this.config.agents.list[0]?.id || "default",
    );

    const sessionKey = deriveSessionKey(context);
    const engine = await this.getOrCreateEngine(sessionKey, agentId, context.channel);

    // Wire streaming callbacks
    const listeners: Array<[string, (...args: unknown[]) => void]> = [];

    if (callbacks.onToken) {
      const fn = (data: unknown) => callbacks.onToken!((data as { content: string }).content);
      engine.on("token", fn);
      listeners.push(["token", fn]);
    }
    if (callbacks.onThinking) {
      const fn = (data: unknown) => callbacks.onThinking!((data as { content: string }).content);
      engine.on("thinking", fn);
      listeners.push(["thinking", fn]);
    }
    if (callbacks.onToolStart) {
      const fn = (data: unknown) => callbacks.onToolStart!((data as { name: string }).name);
      engine.on("tool-start", fn);
      listeners.push(["tool-start", fn]);
    }
    if (callbacks.onToolResult) {
      const fn = (data: unknown) => {
        const d = data as { name: string; success: boolean };
        callbacks.onToolResult!(d.name, d.success);
      };
      engine.on("tool-result", fn);
      listeners.push(["tool-result", fn]);
    }
    if (callbacks.onError) {
      const fn = (data: unknown) => callbacks.onError!((data as { message: string }).message);
      engine.on("error", fn);
      listeners.push(["error", fn]);
    }

    // Tool confirmation handling for adapter channels.
    // If the adapter provides onConfirm, relay the request for interactive approval.
    // Otherwise, auto-approve (for adapters without interactive UI like Signal).
    const confirmFn = (data: unknown) => {
      const { actions, resolve } = data as { actions: unknown[]; resolve: (v: boolean | "always") => void };
      if (callbacks.onConfirm) {
        callbacks.onConfirm(actions, resolve);
      } else {
        resolve("always");
      }
    };
    engine.on("confirm-needed", confirmFn);
    listeners.push(["confirm-needed", confirmFn]);

    try {
      console.log(`  Streaming: sending message to engine (session: ${sessionKey})`);
      const result = await engine.sendMessage(text);
      console.log(`  Streaming: engine returned (${result?.length || 0} chars)`);
      return result;
    } catch (err) {
      console.error(`  Streaming: engine error — ${err instanceof Error ? err.message : err}`);
      throw err;
    } finally {
      for (const [event, fn] of listeners) {
        engine.removeListener(event, fn);
      }
    }
  }

  /** Stop the gateway server */
  async stop(): Promise<void> {
    this.running = false;

    // Stop subsystems
    this.cronScheduler.stop();
    this.taskRegistry.cancelAll();
    this.taskRegistry.stop();
    this.configWatcher.stop();

    // Stop channel adapters
    for (const adapter of this.adapters) {
      try { await adapter.stop(); } catch { /* best effort */ }
    }
    this.adapters = [];

    // Destroy all engines
    for (const engine of this.engines.values()) {
      engine.destroy();
    }
    this.engines.clear();

    // Close all client connections
    for (const [ws] of this.clients) {
      ws.close(1001, "Gateway shutting down");
    }
    this.clients.clear();

    // Close servers
    return new Promise((resolve) => {
      this.wss?.close(() => {
        this.httpServer?.close(() => resolve());
      });
    });
  }

  /** Handle HTTP requests (health, static files) */
  private async handleHttp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url || "/";

    if (url === "/health" || url === "/healthz") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        status: "ok",
        version: "1.8.1",
        uptime: process.uptime(),
        clients: this.clients.size,
        agents: this.engines.size,
      }));
      return;
    }

    if (url === "/status") {
      // Require token for status endpoint (contains session info)
      const authHeader = req.headers.authorization;
      const expectedToken = this.config.gateway.auth.token;
      if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        gateway: { port: this.config.gateway.port, bind: this.config.gateway.bind },
        clients: Array.from(this.clients.values()).map((c) => ({
          clientName: c.clientName,
          sessionKey: c.sessionKey,
          agentId: c.agentId,
        })),
        sessions: this.sessionStore.list().slice(0, 20),
      }));
      return;
    }

    // Serve Web UI at /chat
    if (url === "/chat" || url === "/") {
      try {
        // Try to find index.html relative to this file's location
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const htmlPath = join(__dirname, "web", "index.html");
        const html = await readFile(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      } catch {
        // Fallback: try from src directory (dev mode)
        try {
          const html = await readFile(join(process.cwd(), "src", "web", "index.html"), "utf-8");
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(html);
          return;
        } catch {
          // Fall through to 404
        }
      }
    }

    res.writeHead(404);
    res.end("Not found");
  }

  /** Handle a new WebSocket connection */
  private handleConnection(ws: WebSocket): void {
    const client: ClientConnection = {
      ws,
      clientName: "unknown",
      sessionKey: "",
      agentId: "default",
      authenticated: false,
      eventSeq: 0,
    };
    this.clients.set(ws, client);

    ws.on("message", (data) => {
      const frame = parseFrame(data.toString());
      if (frame) {
        this.handleFrame(client, frame).catch((err) => {
          console.error(`  Frame handler error: ${err instanceof Error ? err.message : err}`);
        });
      }
    });

    ws.on("close", () => {
      this.clients.delete(ws);
    });

    ws.on("error", () => {
      this.clients.delete(ws);
    });
  }

  /** Handle an incoming frame from a client */
  private async handleFrame(client: ClientConnection, frame: Frame): Promise<void> {
    // Handle connect/handshake
    if (frame.type === "connect" || (frame.type === "req" && (frame as RequestFrame).method === "connect")) {
      await this.handleConnect(client, frame as ConnectParams | RequestFrame);
      return;
    }

    // All other frames require authentication
    if (!client.authenticated) {
      this.sendResponse(client, (frame as RequestFrame).id, false, undefined, "Not authenticated");
      return;
    }

    if (frame.type === "req") {
      await this.handleRequest(client, frame);
    }
  }

  /** Handle client connection/auth */
  private async handleConnect(client: ClientConnection, frame: ConnectParams | RequestFrame): Promise<void> {
    const params = frame.type === "connect"
      ? (frame as ConnectParams).params
      : (frame as RequestFrame).params as ConnectParams["params"];
    const reqId = frame.type === "req" ? (frame as RequestFrame).id : 0;

    // Auth check
    const expectedToken = this.config.gateway.auth.token;
    const providedToken = params?.auth?.token;
    if (expectedToken && this.config.gateway.auth.mode !== "none" && providedToken !== expectedToken) {
      client.ws.send(serializeFrame({
        type: "res", id: reqId, ok: false, error: "Invalid token",
      } as ResponseFrame));
      return;
    }

    client.clientName = params?.mode || "unknown";
    client.authenticated = true;

    // Resolve default agent and session
    const agentId = this.config.agents.list[0]?.id || "default";
    const sessionKey = `${client.clientName}:main`;
    client.agentId = agentId;
    client.sessionKey = sessionKey;

    // Send hello with available agents and recent sessions
    const hello: HelloFrame = {
      type: "hello",
      protocol: PROTOCOL_VERSION,
      version: "1.8.1",
      agents: this.config.agents.list.map((a) => ({
        id: a.id,
        name: a.name || a.id,
        model: a.model?.primary || this.config.agents.defaults.model.primary,
        status: "online",
      })),
      sessions: this.sessionStore.list().slice(0, 50).map((s) => ({
        key: s.normalizedKey,
        label: s.label,
        agentId: s.agentId || "default",
        updatedAt: s.updatedAt,
      })),
    };
    client.ws.send(serializeFrame(hello));
    if (reqId) this.sendResponse(client, reqId, true, { agentId, sessionKey });
  }

  /** Handle a request frame */
  private async handleRequest(client: ClientConnection, frame: RequestFrame): Promise<void> {
    try {
      switch (frame.method) {
        // === Chat ===
        case "chat.send":
        case "sendMessage":
          await this.handleSendMessage(client, frame);
          break;

        case "chat.abort":
        case "cancel":
          this.handleCancel(client);
          this.sendResponse(client, frame.id, true);
          break;

        case "chat.history": {
          const historyKey = (frame.params?.sessionKey as string) || client.sessionKey;
          const entry = this.sessionStore.list().find((s) => s.normalizedKey === historyKey);
          const messages = entry ? await this.sessionStore.loadMessages(entry.id) : [];
          const limit = Number(frame.params?.limit) || 200;
          this.sendResponse(client, frame.id, true, messages.slice(-limit));
          break;
        }

        // === Sessions ===
        case "session.list":
          this.sendResponse(client, frame.id, true, this.sessionStore.list());
          break;

        case "session.delete": {
          const delKey = (frame.params?.sessionKey as string) || client.sessionKey;
          await this.sessionStore.delete(delKey);
          this.sendResponse(client, frame.id, true);
          break;
        }

        case "session.reset": {
          const resetKey = (frame.params?.sessionKey as string) || client.sessionKey;
          await this.sessionStore.reset(resetKey);
          const eng = this.engines.get(resetKey);
          if (eng) eng.getContextEngine().clear();
          this.sendResponse(client, frame.id, true);
          break;
        }

        case "session.compact": {
          const compactKey = (frame.params?.sessionKey as string) || client.sessionKey;
          const compactEngine = this.engines.get(compactKey);
          if (compactEngine) {
            const summary = await compactEngine.compactSession();
            this.sendResponse(client, frame.id, true, { summary });
          } else {
            this.sendResponse(client, frame.id, false, "No active session to compact");
          }
          break;
        }

        // === Agents ===
        case "agent.list":
          this.sendResponse(client, frame.id, true, this.config.agents.list.map((a) => ({
            id: a.id,
            name: a.name || a.id,
            model: a.model?.primary || this.config.agents.defaults.model.primary,
            status: "online",
          })));
          break;

        case "agent.status": {
          const aid = frame.params?.agentId as string;
          const agentCfg = this.config.agents.list.find((a) => a.id === aid);
          this.sendResponse(client, frame.id, true, agentCfg ? {
            id: agentCfg.id,
            name: agentCfg.name,
            model: agentCfg.model?.primary || this.config.agents.defaults.model.primary,
            status: "online",
          } : null);
          break;
        }

        // === Tasks ===
        case "task.list":
          this.sendResponse(client, frame.id, true, this.taskRegistry.list().map((t) => ({
            id: t.id, label: t.label, agentId: t.agentId, model: t.model,
            status: t.status, startedAt: t.startedAt, completedAt: t.completedAt,
          })));
          break;

        case "task.status": {
          const task = this.taskRegistry.get(frame.params?.taskId as string);
          this.sendResponse(client, frame.id, true, task ? {
            id: task.id, label: task.label, agentId: task.agentId, model: task.model,
            status: task.status, prompt: task.prompt, result: task.result, error: task.error,
            startedAt: task.startedAt, completedAt: task.completedAt,
            spawnDepth: task.spawnDepth, children: task.children.length,
          } : null);
          break;
        }

        case "task.kill": {
          const killId = frame.params?.taskId as string;
          const killTask = this.taskRegistry.get(killId);
          if (!killTask) {
            this.sendResponse(client, frame.id, false, undefined, "Task not found");
            break;
          }
          const subEng = this.engines.get(`task:${killId}`);
          if (subEng) { subEng.cancel(); subEng.destroy(); this.engines.delete(`task:${killId}`); }
          this.taskRegistry.cancel(killId);
          const cascaded = this.taskRegistry.cascadeCancel(`task:${killId}`);
          this.sendResponse(client, frame.id, true, { killed: killId, cascadeKilled: cascaded });
          break;
        }

        // === Config ===
        case "config.get": {
          const { redactConfig } = await import("../config/redact.js");
          const section = frame.params?.section as string;
          if (section) {
            const val = (this.config as unknown as Record<string, unknown>)[section];
            this.sendResponse(client, frame.id, true, redactConfig(val));
          } else {
            this.sendResponse(client, frame.id, true, redactConfig(this.config));
          }
          break;
        }

        case "config.set": {
          const { loadConfig, saveConfig } = await import("../config/index.js");
          const cfg = await loadConfig();
          const key = frame.params?.key as string;
          const value = frame.params?.value;

          // Protect against prototype pollution
          const BLOCKED_KEYS = ["__proto__", "constructor", "prototype"];
          if (key && value !== undefined) {
            const keys = key.split(".");
            if (keys.some((k) => BLOCKED_KEYS.includes(k))) {
              this.sendResponse(client, frame.id, false, undefined, "Blocked: unsafe key");
              break;
            }
            let target: Record<string, unknown> = cfg as unknown as Record<string, unknown>;
            for (let i = 0; i < keys.length - 1; i++) {
              if (!target[keys[i]] || typeof target[keys[i]] !== "object") target[keys[i]] = {};
              target = target[keys[i]] as Record<string, unknown>;
            }
            target[keys[keys.length - 1]] = value;
            await saveConfig(cfg);
            this.config = cfg;
          }
          this.sendResponse(client, frame.id, true);
          break;
        }

        // === Pipelines ===
        case "pipeline.list":
          this.sendResponse(client, frame.id, true, []); // TODO: wire pipeline runner
          break;

        case "pipeline.run":
          this.sendResponse(client, frame.id, false, undefined, "Pipeline execution via UI coming soon");
          break;

        case "pipeline.status":
        case "pipeline.abort":
          this.sendResponse(client, frame.id, true, null);
          break;

        // === Cron ===
        case "cron.list":
          this.sendResponse(client, frame.id, true, this.cronScheduler.listJobs());
          break;

        case "cron.create": {
          const job = await this.cronScheduler.addJob({
            name: (frame.params?.name as string) || "Unnamed",
            schedule: (frame.params?.schedule as string) || "1h",
            agentId: (frame.params?.agentId as string) || "default",
            prompt: (frame.params?.prompt as string) || "",
          });
          this.sendResponse(client, frame.id, true, job);
          break;
        }

        case "cron.delete":
          await this.cronScheduler.removeJob(frame.params?.jobId as string);
          this.sendResponse(client, frame.id, true);
          break;

        case "cron.trigger": {
          const triggerJob = this.cronScheduler.listJobs().find((j) => j.id === frame.params?.jobId);
          if (triggerJob) {
            const cronEngine = await this.getOrCreateEngine(`cron:${triggerJob.id}`, triggerJob.agentId, "cron");
            cronEngine.sendMessage(triggerJob.prompt); // Fire and forget
            this.sendResponse(client, frame.id, true);
          } else {
            this.sendResponse(client, frame.id, false, undefined, "Job not found");
          }
          break;
        }

        // === Logs ===
        case "log.tail":
          // TODO: implement log streaming
          this.sendResponse(client, frame.id, true, { subscribed: true });
          break;

        case "log.query":
          this.sendResponse(client, frame.id, true, []);
          break;

        default:
          this.sendResponse(client, frame.id, false, undefined, `Unknown method: ${frame.method}`);
      }
    } catch (err) {
      this.sendResponse(client, frame.id, false, undefined, err instanceof Error ? err.message : String(err));
    }
  }

  /** Handle sendMessage — route to agent engine */
  private async handleSendMessage(client: ClientConnection, frame: RequestFrame): Promise<void> {
    const text = (frame.params?.message || frame.params?.text) as string;
    if (!text) {
      this.sendResponse(client, frame.id, false, undefined, "message is required");
      return;
    }

    // Rate limiting — prevent message spam from flooding the model
    if (this.isRateLimited(client.sessionKey)) {
      this.sendResponse(client, frame.id, false, undefined, "Rate limited — too many messages. Wait a moment.");
      return;
    }

    try {
      const engine = await this.getOrCreateEngine(client.sessionKey, client.agentId, client.clientName);

      // Wire engine events to client WebSocket
      const cleanup = this.wireEngineEvents(engine, client);

      try {
        const response = await engine.sendMessage(text);
        this.sendResponse(client, frame.id, true, { text: response });
      } finally {
        cleanup();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.sendResponse(client, frame.id, false, undefined, msg);
    }
  }

  /** Check if a session is rate limited */
  private isRateLimited(sessionKey: string): boolean {
    const now = Date.now();
    const timestamps = this.rateLimiter.get(sessionKey) || [];

    // Clean old entries — only keep timestamps within the window
    const recent = timestamps.filter((t) => now - t < this.RATE_LIMIT_WINDOW);
    recent.push(now);
    this.rateLimiter.set(sessionKey, recent);

    // Periodically purge stale sessions from the map to prevent unbounded growth
    if (this.rateLimiter.size > 100) {
      for (const [key, ts] of this.rateLimiter) {
        if (ts.length === 0 || now - ts[ts.length - 1] > this.RATE_LIMIT_WINDOW * 2) {
          this.rateLimiter.delete(key);
        }
      }
    }

    return recent.length > this.RATE_LIMIT_MAX;
  }

  /** Cancel current request for a client */
  private handleCancel(client: ClientConnection): void {
    const engine = this.engines.get(client.sessionKey);
    if (engine) engine.cancel();
  }

  /** Get or create an agent engine for a session */
  private async getOrCreateEngine(sessionKey: string, agentId: string, channel: string): Promise<AgentEngine> {
    let engine = this.engines.get(sessionKey);
    if (engine) return engine;

    // Find agent config or use defaults
    const agentConfig = this.config.agents.list.find((a) => a.id === agentId);
    const modelConfig = agentConfig?.model || this.config.agents.defaults.model;

    // If any model in the chain uses Codex OAuth, resolve a fresh token
    const allModels = [modelConfig.primary, ...(modelConfig.fallbacks || [])];
    if (allModels.some((m) => m.startsWith("codex/"))) {
      try {
        const token = await this.authProfileStore.resolveApiKey("openai-codex:default");
        (this.config.models.providers as Record<string, unknown>).codex = { apiKey: token };
      } catch (err) {
        console.error(`  Codex OAuth: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Resolve provider with fallback chain
    const resolved = await resolveWithFallback(
      modelConfig.primary,
      modelConfig.fallbacks || [],
      this.config.models.providers,
      { maxResponseTokens: this.config.agents.defaults.maxResponseTokens },
    );

    const identity: AgentIdentity = {
      id: agentId,
      name: agentConfig?.name || "Clank",
      model: modelConfig,
      workspace: agentConfig?.workspace || this.config.agents.defaults.workspace || process.cwd(),
      toolTier: agentConfig?.toolTier || this.config.agents.defaults.toolTier || "auto",
      tools: agentConfig?.tools,
    };

    // Determine spawn depth for this engine (needed before system prompt build)
    const currentDepth = sessionKey.startsWith("task:")
      ? (this.taskRegistry.getBySessionKey(sessionKey)?.spawnDepth ?? 0) + 1
      : 0;

    // Build system prompt from workspace files + memory
    // Sub-agents (spawnDepth > 0) get RUNNER.md injected for structured execution
    const compact = agentConfig?.compactPrompt ?? this.config.agents.defaults.compactPrompt ?? false;
    const thinking = agentConfig?.thinking ?? this.config.agents.defaults.thinking ?? "auto";
    const systemPrompt = await buildSystemPrompt({
      identity,
      workspaceDir: identity.workspace,
      channel,
      compact,
      thinking,
      spawnDepth: currentDepth,
      isLocal: resolved.isLocal,
    });

    // Inject memory context into system prompt — use a smaller budget for
    // local models since their context windows are limited (8K-32K).
    // Local models skip MEMORY.md from workspace files and rely entirely
    // on TF-IDF relevance matching here instead.
    const memoryBudget = resolved.isLocal ? 800 : 4000;
    const memoryBlock = await this.memoryManager.buildMemoryBlock("session", identity.workspace, memoryBudget);
    const fullPrompt = memoryBlock
      ? systemPrompt + "\n\n---\n\n" + memoryBlock
      : systemPrompt;

    const maxSpawnDepth = this.config.agents.defaults.subagents?.maxSpawnDepth ?? 1;
    const maxConcurrent = this.config.agents.defaults.subagents?.maxConcurrent ?? 8;

    // Agents within the depth limit can spawn sub-agents
    const canSpawn = currentDepth < maxSpawnDepth;

    const spawnTaskFn = canSpawn ? async (opts: {
      agentId: string; prompt: string; label: string; timeoutMs: number;
    }): Promise<string> => {
      // Enforce concurrent limit
      const active = this.taskRegistry.countActiveByParent(sessionKey);
      if (active >= maxConcurrent) {
        throw new Error(`Concurrent task limit reached (${active}/${maxConcurrent}). Kill a task first.`);
      }

      const subAgentConfig = this.config.agents.list.find((a) => a.id === opts.agentId);
      const subModel = subAgentConfig?.model?.primary || this.config.agents.defaults.model.primary;

      const task = this.taskRegistry.create({
        agentId: opts.agentId,
        model: subModel,
        prompt: opts.prompt,
        label: opts.label,
        timeoutMs: opts.timeoutMs,
        spawnedBy: sessionKey,
        spawnDepth: currentDepth,
        parentSessionKey: sessionKey,
      });

      // Create sub-agent engine in the background
      const subSessionKey = `task:${task.id}`;
      const subEngine = await this.getOrCreateEngine(subSessionKey, opts.agentId, "task");

      // Run with timeout — fire and forget
      const timeout = setTimeout(() => {
        subEngine.cancel();
        this.taskRegistry.update(task.id, { status: "timeout", completedAt: Date.now(), error: "Task timed out" });
        subEngine.destroy();
        this.engines.delete(subSessionKey);
      }, opts.timeoutMs);

      subEngine.sendMessage(opts.prompt).then((result) => {
        clearTimeout(timeout);
        this.taskRegistry.update(task.id, { status: "completed", result, completedAt: Date.now() });
        subEngine.destroy();
        this.engines.delete(subSessionKey);
      }).catch((err) => {
        clearTimeout(timeout);
        this.taskRegistry.update(task.id, {
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          completedAt: Date.now(),
        });
        subEngine.destroy();
        this.engines.delete(subSessionKey);
      });

      return task.id;
    } : undefined;

    // Kill task function — cancel a task and cascade-kill children
    const killTaskFn = async (taskId: string): Promise<{ status: string; cascadeKilled?: number }> => {
      const task = this.taskRegistry.get(taskId);
      if (!task) return { status: "not_found" };
      if (task.spawnedBy !== sessionKey) return { status: "not_owner" };
      if (task.status !== "running") return { status: "already_done" };

      // Cancel the task's engine
      const subEngine = this.engines.get(`task:${taskId}`);
      if (subEngine) {
        subEngine.cancel();
        subEngine.destroy();
        this.engines.delete(`task:${taskId}`);
      }

      this.taskRegistry.cancel(taskId);
      const cascadeKilled = this.taskRegistry.cascadeCancel(`task:${taskId}`);
      return { status: "ok", cascadeKilled };
    };

    // Message task function — send a message to a running child
    const messageTaskFn = async (taskId: string, message: string): Promise<{ status: string; replyText?: string }> => {
      const task = this.taskRegistry.get(taskId);
      if (!task) return { status: "not_found" };
      if (task.spawnedBy !== sessionKey) return { status: "not_owner" };
      if (task.status !== "running") return { status: "not_running" };

      const subEngine = this.engines.get(`task:${taskId}`);
      if (!subEngine) return { status: "not_found" };

      try {
        const reply = await subEngine.sendMessage(message);
        return { status: "ok", replyText: reply };
      } catch (err) {
        return { status: "error", replyText: err instanceof Error ? err.message : String(err) };
      }
    };

    // Sub-agent system prompt addition
    let finalPrompt = fullPrompt;
    if (currentDepth > 0) {
      const depthNote = currentDepth < maxSpawnDepth
        ? "You can spawn further sub-agents if needed."
        : "You cannot spawn further sub-agents (depth limit reached).";
      finalPrompt = `[Sub-Agent] You were spawned by a parent agent to complete a specific task.\n${depthNote}\n\n---\n\n${fullPrompt}`;
    }

    engine = new AgentEngine({
      identity,
      toolRegistry: this.toolRegistry,
      sessionStore: this.sessionStore,
      provider: resolved,
      autoApprove: this.config.tools.autoApprove,
      systemPrompt: finalPrompt,
      taskRegistry: this.taskRegistry,
      spawnTask: spawnTaskFn,
      killTask: killTaskFn,
      messageTask: messageTaskFn,
      sessionKey,
      spawnDepth: currentDepth,
      maxSpawnDepth,
    });

    await engine.loadSession(sessionKey, channel);
    this.engines.set(sessionKey, engine);

    // Execute plugin hooks
    await this.pluginLoader.executeHooks("before_agent_start", { agentId, sessionKey });

    return engine;
  }

  /**
   * Wire engine events to a client's WebSocket.
   * Returns a cleanup function to remove listeners.
   */
  private wireEngineEvents(engine: AgentEngine, client: ClientConnection): () => void {
    const eventMap: Record<string, string> = {
      "token": "token",
      "thinking": "thinking",
      "response-start": "response-start",
      "response-end": "response-end",
      "tool-start": "tool-start",
      "tool-result": "tool-result",
      "context-compacting": "context-compacting",
      "usage": "usage",
      "error": "error",
      "turn-complete": "turn-complete",
    };

    const listeners: Array<[string, (...args: unknown[]) => void]> = [];

    for (const [engineEvent, wireEvent] of Object.entries(eventMap)) {
      const listener = (payload: unknown) => {
        this.sendEvent(client, wireEvent, payload);
      };
      engine.on(engineEvent, listener);
      listeners.push([engineEvent, listener]);
    }

    // Confirmation events — respect the config autoApprove settings.
    // For channels (Telegram/Discord), use the config. For WebSocket
    // clients (TUI/Web), relay to the client for interactive approval.
    const confirmListener = (data: unknown) => {
      const { actions, resolve } = data as { actions: unknown[]; resolve: (v: boolean | "always") => void };
      const action = (actions as Array<{ safetyLevel: string }>)[0];
      const level = (action?.safetyLevel || "high") as "low" | "medium" | "high";

      // Check autoApprove config
      if (this.config.tools.autoApprove[level]) {
        resolve(true);
        return;
      }

      // For WebSocket clients, relay the confirmation request
      const confirmId = `confirm_${Date.now()}`;
      this.sendEvent(client, "confirm-needed", { id: confirmId, actions });

      // Listen for resolve from client (one-shot)
      const resolveHandler = (raw: Buffer | string) => {
        const frame = parseFrame(raw.toString());
        if (frame?.type === "req" && (frame as RequestFrame).method === "confirm.resolve") {
          const params = (frame as RequestFrame).params as { id?: string; approved?: boolean | "always" };
          if (params?.id === confirmId) {
            clearTimeout(timeout);
            client.ws.removeListener("message", resolveHandler);
            resolve(params.approved ?? false);
          }
        }
      };
      client.ws.on("message", resolveHandler);

      // Default deny after 30s timeout — must also remove the WS listener
      // to prevent accumulating orphaned handlers across messages
      const timeout = setTimeout(() => {
        client.ws.removeListener("message", resolveHandler);
        resolve(false);
      }, 30_000);
    };
    engine.on("confirm-needed", confirmListener);
    listeners.push(["confirm-needed", confirmListener]);

    return () => {
      for (const [event, listener] of listeners) {
        engine.removeListener(event, listener);
      }
    };
  }

  /** Send a response frame to a client */
  private sendResponse(client: ClientConnection, id: number | string, ok: boolean, result?: unknown, error?: string): void {
    const frame: ResponseFrame = { type: "res", id, ok, result, error };
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serializeFrame(frame));
    }
  }

  /** Send an event frame to a client */
  private sendEvent(client: ClientConnection, event: string, payload: unknown): void {
    const frame: EventFrame = { type: "event", event, payload, seq: ++client.eventSeq };
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serializeFrame(frame));
    }
  }

  get isRunning(): boolean {
    return this.running;
  }
}
