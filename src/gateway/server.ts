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
import { resolveRoute, deriveSessionKey, type RouteContext } from "../routing/index.js";
import { type ChannelAdapter } from "../adapters/base.js";
import { TelegramAdapter } from "../adapters/telegram.js";
import { DiscordAdapter } from "../adapters/discord.js";
import { WebAdapter } from "../adapters/web.js";
import { PluginLoader } from "../plugins/index.js";
import {
  type Frame,
  type RequestFrame,
  type ResponseFrame,
  type EventFrame,
  type ConnectParams,
  type HelloOk,
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
  private adapters: ChannelAdapter[] = [];
  private running = false;

  constructor(config: ClankConfig) {
    this.config = config;
    this.sessionStore = new SessionStore(join(getConfigDir(), "conversations"));
    this.toolRegistry = createFullRegistry();
    this.memoryManager = new MemoryManager(join(getConfigDir(), "memory"));
    this.cronScheduler = new CronScheduler(join(getConfigDir(), "cron"));
    this.configWatcher = new ConfigWatcher();
    this.pluginLoader = new PluginLoader();
  }

  /** Start the gateway server */
  async start(): Promise<void> {
    // Initialize subsystems
    await this.sessionStore.init();
    await this.memoryManager.init();
    await this.cronScheduler.init();

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
   * Handle an inbound message from any channel adapter.
   * This is the main entry point for all non-WebSocket messages.
   */
  async handleInboundMessage(context: RouteContext, text: string): Promise<string> {
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

  /** Stop the gateway server */
  async stop(): Promise<void> {
    this.running = false;

    // Stop subsystems
    this.cronScheduler.stop();
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
        version: "0.1.0",
        uptime: process.uptime(),
        clients: this.clients.size,
        agents: this.engines.size,
      }));
      return;
    }

    if (url === "/status") {
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
        const htmlPath = join(__dirname, "..", "web", "index.html");
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
      if (frame) this.handleFrame(client, frame);
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
    const params = frame.type === "connect" ? frame : (frame as RequestFrame).params as unknown as ConnectParams;
    const reqId = frame.type === "req" ? (frame as RequestFrame).id : 0;

    // Auth check
    const expectedToken = this.config.gateway.auth.token;
    if (expectedToken && params?.token !== expectedToken) {
      const hello: HelloOk = {
        type: "hello",
        ok: false,
        version: "0.1.0",
        agentId: "",
        sessionKey: "",
        error: "Invalid token",
      };
      client.ws.send(serializeFrame(hello));
      if (reqId) this.sendResponse(client, reqId, false, undefined, "Invalid token");
      return;
    }

    client.clientName = (params as ConnectParams)?.clientName || "unknown";
    client.authenticated = true;

    // Resolve default agent and session
    const agentId = "default";
    const sessionKey = `${client.clientName}:main`;
    client.agentId = agentId;
    client.sessionKey = sessionKey;

    const hello: HelloOk = {
      type: "hello",
      ok: true,
      version: "0.1.0",
      agentId,
      sessionKey,
    };
    client.ws.send(serializeFrame(hello));
    if (reqId) this.sendResponse(client, reqId, true, { agentId, sessionKey });
  }

  /** Handle a request frame */
  private async handleRequest(client: ClientConnection, frame: RequestFrame): Promise<void> {
    switch (frame.method) {
      case "sendMessage":
        await this.handleSendMessage(client, frame);
        break;

      case "cancel":
        this.handleCancel(client);
        this.sendResponse(client, frame.id, true);
        break;

      case "sessions/list":
        this.sendResponse(client, frame.id, true, this.sessionStore.list());
        break;

      case "sessions/reset":
        await this.sessionStore.reset(client.sessionKey);
        const engine = this.engines.get(client.sessionKey);
        if (engine) engine.getContextEngine().clear();
        this.sendResponse(client, frame.id, true);
        break;

      case "sessions/delete":
        const key = (frame.params?.sessionKey as string) || client.sessionKey;
        await this.sessionStore.delete(key);
        this.sendResponse(client, frame.id, true);
        break;

      default:
        this.sendResponse(client, frame.id, false, undefined, `Unknown method: ${frame.method}`);
    }
  }

  /** Handle sendMessage — route to agent engine */
  private async handleSendMessage(client: ClientConnection, frame: RequestFrame): Promise<void> {
    const text = frame.params?.text as string;
    if (!text) {
      this.sendResponse(client, frame.id, false, undefined, "text is required");
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

    // Build system prompt from workspace files + memory
    const systemPrompt = await buildSystemPrompt({
      identity,
      workspaceDir: identity.workspace,
      channel,
    });

    // Inject memory context into system prompt
    const memoryBlock = await this.memoryManager.buildMemoryBlock("", identity.workspace);
    const fullPrompt = memoryBlock
      ? systemPrompt + "\n\n---\n\n" + memoryBlock
      : systemPrompt;

    engine = new AgentEngine({
      identity,
      toolRegistry: this.toolRegistry,
      sessionStore: this.sessionStore,
      provider: resolved,
      autoApprove: this.config.tools.autoApprove,
      systemPrompt: fullPrompt,
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

    // Confirmation events need special handling — we need to relay
    // the resolve callback through the WebSocket protocol
    const confirmListener = (data: unknown) => {
      const { actions, resolve } = data as { actions: unknown[]; resolve: (v: boolean | "always") => void };
      const confirmId = `confirm_${Date.now()}`;
      this.sendEvent(client, "confirm-needed", { id: confirmId, actions });
      // TODO: Wire up resolve via incoming "resolve" frame from client
      // For now, auto-approve (gateway mode trusts the config)
      resolve(true);
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
  private sendResponse(client: ClientConnection, id: number | string, ok: boolean, payload?: unknown, error?: string): void {
    const frame: ResponseFrame = { type: "res", id, ok, payload, error };
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
