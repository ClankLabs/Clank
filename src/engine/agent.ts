/**
 * AgentEngine — the core of Clank.
 *
 * This is the ReAct loop: Reason → Act → Observe → Repeat.
 * The engine streams from an LLM provider, detects tool calls,
 * executes them (with user confirmation for risky ones), feeds
 * results back, and loops until the model responds with plain text.
 *
 * Events are emitted at every stage so frontends (CLI, Web, Telegram)
 * can display progress in real-time without knowing the internals.
 */

import { EventEmitter } from "node:events";
import { ContextEngine } from "./context-engine.js";
import { ToolRegistry, type ToolContext, type Tool, type ToolTier } from "../tools/index.js";
import { shouldPersist, extractMemory, appendToMemory } from "../memory/auto-persist.js";
import {
  type BaseProvider,
  type Message,
  type StreamEvent,
  type ToolDefinition,
  type ResolvedProvider,
} from "../providers/types.js";
import { OllamaProvider } from "../providers/ollama.js";
import { PromptFallbackProvider } from "../providers/prompt-fallback.js";
import { SessionStore, type SessionEntry } from "../sessions/index.js";

/** Agent identity — who is this agent? */
export interface AgentIdentity {
  id: string;
  name: string;
  model: { primary: string; fallbacks?: string[] };
  workspace: string;
  toolTier: ToolTier;
  temperature?: number;
  maxResponseTokens?: number;
  tools?: { allow?: string[]; deny?: string[] };
}

/** Events the engine emits */
export interface AgentEvents {
  "thinking-start": () => void;
  "thinking-stop": () => void;
  "response-start": () => void;
  "token": (data: { content: string }) => void;
  "response-end": (data: { text: string }) => void;
  "tool-start": (data: { id: string; name: string; arguments: Record<string, unknown> }) => void;
  "tool-result": (data: { id: string; name: string; success: boolean; summary: string }) => void;
  "confirm-needed": (data: { actions: ConfirmAction[]; resolve: (approved: boolean | "always") => void }) => void;
  "context-compacting": () => void;
  "usage": (data: { promptTokens: number; outputTokens: number; iterationCount: number; contextPercent: number }) => void;
  "error": (data: { message: string; recoverable: boolean }) => void;
  "turn-complete": () => void;
}

export interface ConfirmAction {
  toolName: string;
  description: string;
  safetyLevel: string;
}

const MAX_ITERATIONS = 50;

export class AgentEngine extends EventEmitter {
  readonly identity: AgentIdentity;
  private contextEngine: ContextEngine;
  private toolRegistry: ToolRegistry;
  private resolvedProvider: ResolvedProvider | null = null;
  private sessionStore: SessionStore;
  private currentSession: SessionEntry | null = null;
  private abortController: AbortController | null = null;
  private systemPrompt: string = "";
  private autoApprove = { low: true, medium: false, high: false };
  /** Tools the user has approved "always" for this session */
  private alwaysApproved = new Set<string>();

  constructor(opts: {
    identity: AgentIdentity;
    toolRegistry: ToolRegistry;
    sessionStore: SessionStore;
    provider: ResolvedProvider;
    autoApprove?: { low: boolean; medium: boolean; high: boolean };
    systemPrompt?: string;
  }) {
    super();
    this.identity = opts.identity;
    this.toolRegistry = opts.toolRegistry;
    this.sessionStore = opts.sessionStore;
    this.resolvedProvider = opts.provider;
    if (opts.autoApprove) this.autoApprove = opts.autoApprove;
    if (opts.systemPrompt) this.systemPrompt = opts.systemPrompt;

    this.contextEngine = new ContextEngine({
      contextWindow: opts.provider.provider.contextWindow(),
      isLocal: opts.provider.isLocal,
    });

    // Wire provider into context engine for tier 2 LLM-summarized compaction
    this.contextEngine.setProvider(opts.provider.provider, opts.identity.model.primary);
  }

  /** Set the system prompt */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
    // Update token budget in context engine
    this.contextEngine.setSystemPromptSize(Math.ceil(prompt.length / 4));
  }

  /** Load or create a session */
  async loadSession(normalizedKey: string, channel: string): Promise<void> {
    this.currentSession = await this.sessionStore.resolve(normalizedKey, {
      agentId: this.identity.id,
      channel,
    });

    const messages = await this.sessionStore.loadMessages(this.currentSession.id);
    this.contextEngine.setMessages(messages);

    // Detect context window for Ollama models
    if (this.resolvedProvider?.provider instanceof OllamaProvider) {
      const ctxSize = await (this.resolvedProvider.provider as OllamaProvider).detectContextWindow();
      this.contextEngine.setContextWindow(ctxSize);
    }

    // If loaded session is too big for the context window, compact immediately
    if (this.contextEngine.needsCompaction()) {
      await this.contextEngine.compactSmart();
    }
  }

  /** Cancel the current request */
  cancel(): void {
    this.abortController?.abort();
    this.emit("cancelled");
  }

  /**
   * Send a message and get a response.
   * This is THE agent loop — the heart of Clank.
   */
  async sendMessage(text: string): Promise<string> {
    if (!this.resolvedProvider) {
      throw new Error("No provider configured");
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Add user message to context
    this.contextEngine.ingest({ role: "user", content: text });

    // Auto-persist important user statements to memory (background, non-blocking)
    if (shouldPersist(text)) {
      const memory = extractMemory(text);
      if (memory) {
        appendToMemory(this.identity.workspace, memory).catch(() => {});
      }
    }

    // Auto-title session from first message
    if (this.currentSession && !this.currentSession.label) {
      const label = text.length > 60 ? text.slice(0, 57) + "..." : text;
      await this.sessionStore.setLabel(this.currentSession.normalizedKey, label);
    }

    const provider = this.resolvedProvider.provider;
    const isLocal = this.resolvedProvider.isLocal;

    // Wrap provider with prompt fallback if model doesn't support tools
    let activeProvider: BaseProvider = provider;
    if (isLocal && provider instanceof OllamaProvider) {
      const modelName = this.identity.model.primary.split("/").pop() || "";
      if (!OllamaProvider.supportsTools(modelName)) {
        activeProvider = new PromptFallbackProvider(provider);
      }
    }

    let fullResponse = "";
    let iterationCount = 0;

    try {
      // === THE REACT LOOP ===
      while (iterationCount < MAX_ITERATIONS) {
        iterationCount++;

        // Check if compaction is needed
        if (this.contextEngine.needsCompaction()) {
          this.emit("context-compacting");
          // Use smart (async) compaction with LLM summary if available
          const compactResult = await this.contextEngine.compactSmart();
          if (compactResult.tier === 2) {
            this.emit("usage", {
              promptTokens: 0, outputTokens: 0, iterationCount,
              contextPercent: Math.round(this.contextEngine.utilizationPercent()),
            });
          }
        }

        // Get tool definitions for this iteration
        const toolDefs = this.toolRegistry.getDefinitions({
          tier: this.identity.toolTier,
          userMessage: text,
          allowlist: this.identity.tools?.allow,
          denylist: this.identity.tools?.deny,
        });

        // Stream from the provider (with retry on transient failures)
        let iterationText = "";
        const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
        let promptTokens = 0;
        let outputTokens = 0;
        let streamSuccess = false;

        this.emit("response-start");

        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const streamIterator = activeProvider.stream(
              this.contextEngine.getMessages(),
              this.systemPrompt,
              toolDefs,
              signal,
            );

        for await (const event of streamIterator) {
          switch (event.type) {
            case "text":
              iterationText += event.content;
              this.emit("token", { content: event.content });
              break;

            case "thinking":
              this.emit("thinking-start");
              // Thinking content not added to visible response
              break;

            case "tool_call":
              toolCalls.push({
                id: event.id,
                name: event.name,
                arguments: event.arguments,
              });
              break;

            case "usage":
              promptTokens = event.promptTokens;
              outputTokens = event.outputTokens;
              break;

            case "done":
              break;
          }
        }
            streamSuccess = true;
            break; // Success — exit retry loop
          } catch (streamErr) {
            if (attempt === 0 && !signal.aborted) {
              // First failure — retry once after brief pause
              this.emit("error", {
                message: `Model connection failed, retrying... (${streamErr instanceof Error ? streamErr.message : "unknown"})`,
                recoverable: true,
              });
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            throw streamErr; // Second failure — propagate
          }
        } // end retry loop

        if (!streamSuccess) {
          this.emit("error", { message: "Model failed to respond after retry", recoverable: false });
          break;
        }

        // Emit usage stats
        this.emit("usage", {
          promptTokens,
          outputTokens,
          iterationCount,
          contextPercent: Math.round(this.contextEngine.utilizationPercent()),
        });

        // If no tool calls, we're done — this is the final response
        if (toolCalls.length === 0) {
          fullResponse = iterationText;
          this.contextEngine.ingest({ role: "assistant", content: iterationText });
          this.emit("response-end", { text: iterationText });
          break;
        }

        // Add assistant message with tool calls to context
        const assistantMsg = activeProvider.formatAssistantToolUse(
          toolCalls[0].id,
          toolCalls[0].name,
          toolCalls[0].arguments,
        );
        // If there's text before tool calls, prepend it
        if (iterationText) {
          assistantMsg.content = iterationText;
        }
        // For multiple tool calls, add them all
        if (toolCalls.length > 1 && assistantMsg.tool_calls) {
          assistantMsg.tool_calls = toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        this.contextEngine.ingest(assistantMsg);

        this.emit("response-end", { text: iterationText });

        // Execute tool calls sequentially
        for (const tc of toolCalls) {
          const tool = this.toolRegistry.get(tc.name);
          if (!tool) {
            const errorResult = activeProvider.formatToolResult(tc.id, tc.name, `Error: Unknown tool "${tc.name}"`, true);
            this.contextEngine.ingest(errorResult);
            continue;
          }

          this.emit("tool-start", { id: tc.id, name: tc.name, arguments: tc.arguments });

          // Validate
          const toolCtx: ToolContext = {
            projectRoot: this.identity.workspace,
            autoApprove: this.autoApprove,
            agentId: this.identity.id,
            signal,
          };

          const validation = tool.validate(tc.arguments, toolCtx);
          if (!validation.ok) {
            const result = activeProvider.formatToolResult(tc.id, tc.name, `Validation error: ${validation.error}`, true);
            this.contextEngine.ingest(result);
            this.emit("tool-result", { id: tc.id, name: tc.name, success: false, summary: validation.error || "Validation failed" });
            continue;
          }

          // Check if confirmation is needed
          const level = typeof tool.safetyLevel === "function" ? tool.safetyLevel(tc.arguments) : tool.safetyLevel;
          const needsConfirm = !this.autoApprove[level] && !this.alwaysApproved.has(tc.name);

          if (needsConfirm) {
            const approved = await this.requestConfirmation(tool, tc);
            if (!approved) {
              const result = activeProvider.formatToolResult(tc.id, tc.name, "Tool execution denied by user", true);
              this.contextEngine.ingest(result);
              this.emit("tool-result", { id: tc.id, name: tc.name, success: false, summary: "Denied by user" });
              continue;
            }
          }

          // Execute
          try {
            const output = await tool.execute(tc.arguments, toolCtx);
            const result = activeProvider.formatToolResult(tc.id, tc.name, output);
            this.contextEngine.ingest(result);
            this.emit("tool-result", {
              id: tc.id,
              name: tc.name,
              success: true,
              summary: output.length > 100 ? output.slice(0, 97) + "..." : output,
            });
          } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            const result = activeProvider.formatToolResult(tc.id, tc.name, `Error: ${errMsg}`, true);
            this.contextEngine.ingest(result);
            this.emit("tool-result", { id: tc.id, name: tc.name, success: false, summary: errMsg });
          }
        }

        // Loop continues — the model will see tool results and decide next action
      }

      if (iterationCount >= MAX_ITERATIONS) {
        this.emit("error", { message: "Max iterations reached", recoverable: true });
      }
    } catch (err: unknown) {
      if (signal.aborted) {
        return "";
      }
      const errMsg = err instanceof Error ? err.message : String(err);
      this.emit("error", { message: errMsg, recoverable: false });
      throw err;
    } finally {
      // Save session
      if (this.currentSession) {
        await this.sessionStore.saveMessages(this.currentSession.id, this.contextEngine.getMessages());
      }
      this.emit("turn-complete");
      this.abortController = null;
    }

    return fullResponse;
  }

  /**
   * Request user confirmation for a tool execution.
   * Returns a promise that resolves when the user responds.
   */
  private requestConfirmation(
    tool: Tool,
    tc: { id: string; name: string; arguments: Record<string, unknown> },
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const description = tool.formatConfirmation
        ? tool.formatConfirmation(tc.arguments)
        : `Execute ${tc.name}`;

      const level = typeof tool.safetyLevel === "function" ? tool.safetyLevel(tc.arguments) : tool.safetyLevel;

      this.emit("confirm-needed", {
        actions: [{ toolName: tc.name, description, safetyLevel: level }],
        resolve: (approved: boolean | "always") => {
          if (approved === "always") {
            this.alwaysApproved.add(tc.name);
            resolve(true);
          } else {
            resolve(approved);
          }
        },
      });
    });
  }

  /** Get the context engine (for direct access if needed) */
  getContextEngine(): ContextEngine {
    return this.contextEngine;
  }

  /** Destroy the engine and clean up */
  destroy(): void {
    this.cancel();
    this.removeAllListeners();
  }
}
