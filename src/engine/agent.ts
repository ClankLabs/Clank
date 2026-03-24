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
  supportsNativeTools,
} from "../providers/types.js";
import { OllamaProvider } from "../providers/ollama.js";
import { PromptFallbackProvider } from "../providers/prompt-fallback.js";
import type { TaskRegistry } from "../tasks/index.js";
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
  /** Background task registry (if available) */
  private taskRegistry: TaskRegistry | null = null;
  /** Function to spawn background tasks */
  private spawnTaskFn: ToolContext["spawnTask"] = undefined;
  /** Function to kill a running task */
  private killTaskFn: ToolContext["killTask"] = undefined;
  /** Function to message a running child task */
  private messageTaskFn: ToolContext["messageTask"] = undefined;
  /** Session key for this engine */
  private sessionKey: string = "";
  /** Spawn depth: 0 = main, 1+ = sub-agent */
  private spawnDepth: number = 0;
  /** Maximum allowed spawn depth */
  private maxSpawnDepth: number = 1;

  constructor(opts: {
    identity: AgentIdentity;
    toolRegistry: ToolRegistry;
    sessionStore: SessionStore;
    provider: ResolvedProvider;
    autoApprove?: { low: boolean; medium: boolean; high: boolean };
    systemPrompt?: string;
    taskRegistry?: TaskRegistry;
    spawnTask?: ToolContext["spawnTask"];
    killTask?: ToolContext["killTask"];
    messageTask?: ToolContext["messageTask"];
    sessionKey?: string;
    spawnDepth?: number;
    maxSpawnDepth?: number;
  }) {
    super();
    // Engine is reused across messages — each message adds/removes listeners
    // via wireEngineEvents(), so we need headroom beyond the default 10
    this.setMaxListeners(30);
    this.identity = opts.identity;
    this.toolRegistry = opts.toolRegistry;
    this.sessionStore = opts.sessionStore;
    this.resolvedProvider = opts.provider;
    if (opts.autoApprove) this.autoApprove = opts.autoApprove;
    if (opts.systemPrompt) this.systemPrompt = opts.systemPrompt;
    if (opts.taskRegistry) this.taskRegistry = opts.taskRegistry;
    if (opts.spawnTask) this.spawnTaskFn = opts.spawnTask;
    if (opts.killTask) this.killTaskFn = opts.killTask;
    if (opts.messageTask) this.messageTaskFn = opts.messageTask;
    if (opts.sessionKey) this.sessionKey = opts.sessionKey;
    if (opts.spawnDepth !== undefined) this.spawnDepth = opts.spawnDepth;
    if (opts.maxSpawnDepth !== undefined) this.maxSpawnDepth = opts.maxSpawnDepth;

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

    // Inject completed background task results before processing
    if (this.taskRegistry && this.sessionKey) {
      const completed = this.taskRegistry.consumeCompleted(this.sessionKey);
      if (completed.length > 0) {
        const results = completed.map((t) => {
          if (t.status === "completed") {
            return `[Task Complete] "${t.label}" (agent: ${t.agentId}):\n${t.result}`;
          }
          return `[Task ${t.status === "failed" ? "Failed" : "Timed Out"}] "${t.label}" (agent: ${t.agentId}): ${t.error || "unknown error"}`;
        }).join("\n\n");
        this.contextEngine.ingest({
          role: "user",
          content: `[System] Background tasks completed:\n\n${results}`,
        });
      }
    }

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

    // Wrap local providers with prompt fallback if the model doesn't support
    // native tool calling. This applies to ALL local providers (Ollama,
    // llama.cpp, LM Studio, vLLM, etc.) — not just Ollama. The fallback
    // injects tools into the system prompt as text and parses the model's
    // text output for ```tool_call``` blocks via regex.
    let activeProvider: BaseProvider = provider;
    if (isLocal && !supportsNativeTools(this.identity.model.primary)) {
      activeProvider = new PromptFallbackProvider(provider);
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
        let thinkingText = "";
        const toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
        let promptTokens = 0;
        let outputTokens = 0;
        let streamSuccess = false;

        this.emit("response-start");

        for (let attempt = 0; attempt < 2; attempt++) {
          // Reset per-attempt state so retries start clean
          if (attempt > 0) {
            iterationText = "";
            thinkingText = "";
            toolCalls.length = 0;
            promptTokens = 0;
            outputTokens = 0;
          }

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
              // Emit thinking content per-chunk so frontends can display it
              // in a separate collapsible block. Also accumulate it — some
              // local models (Qwen3.5) put ALL output in reasoning_content
              // with empty content, so we may need to use thinking as the
              // response if iterationText ends up empty.
              thinkingText += event.content;
              this.emit("thinking", { content: event.content });
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
            const errMsg = streamErr instanceof Error ? streamErr.message : "unknown";

            // Don't retry timeouts or aborts — the model is unresponsive
            const isTimeout = streamErr instanceof Error && (
              streamErr.name === "TimeoutError" ||
              streamErr.name === "AbortError" ||
              errMsg.includes("timed out")
            );

            // Retryable errors: connection failures, stream drops, empty responses.
            // These are transient — the model may recover on a second attempt.
            const isRetryable = !isTimeout && !signal.aborted && (
              errMsg.includes("connection dropped") ||
              errMsg.includes("stopped responding") ||
              errMsg.includes("empty response") ||
              errMsg.includes("fetch failed") ||
              errMsg.includes("ECONNREFUSED") ||
              errMsg.includes("ECONNRESET")
            );

            if (attempt === 0 && (isRetryable || (!signal.aborted && !isTimeout))) {
              this.emit("error", {
                message: `Model stream failed, retrying... (${errMsg})`,
                recoverable: true,
              });
              await new Promise((r) => setTimeout(r, 2000));
              continue;
            }
            throw streamErr; // Timeout, abort, or second failure — propagate
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

        // If no tool calls, we're done — this is the final response.
        // Some local thinking models (Qwen3.5) put ALL output in
        // reasoning_content with empty content. If iterationText is empty
        // but we got thinking, use thinking as the response so the user
        // isn't left with a blank message.
        if (toolCalls.length === 0) {
          if (!iterationText && thinkingText) {
            iterationText = thinkingText;
            // Emit as tokens so frontends display it as the response
            this.emit("token", { content: iterationText });
          }
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
            allowExternal: true,
            autoApprove: this.autoApprove,
            agentId: this.identity.id,
            signal,
            taskRegistry: this.taskRegistry ?? undefined,
            spawnTask: this.spawnTaskFn,
            killTask: this.killTaskFn,
            messageTask: this.messageTaskFn,
            spawnDepth: this.spawnDepth,
            maxSpawnDepth: this.maxSpawnDepth,
            sessionKey: this.sessionKey,
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

  /**
   * Compact: summarize current state, clear context, inject summary.
   * Returns the summary so callers can display it.
   */
  async compactSession(): Promise<string> {
    const messages = this.contextEngine.getMessages();

    if (messages.length < 3) {
      return "Nothing to compact — session is too short.";
    }

    // Build a state snapshot from the conversation for the model to summarize
    const conversationText = messages
      .slice(-30) // last 30 messages max to keep the summary prompt manageable
      .map((m) => {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        const truncated = content.length > 400 ? content.slice(0, 400) + "..." : content;
        return `${m.role}: ${truncated}`;
      })
      .join("\n\n");

    const summaryPrompt = [
      "You are summarizing a conversation for context continuity.",
      "The user is compacting their session — they want to clear context but continue seamlessly.",
      "",
      "Produce a concise state summary covering:",
      "- What task(s) the user is working on",
      "- Key decisions made so far",
      "- Files created, modified, or discussed",
      "- Current progress and what comes next",
      "- Any important context (preferences, constraints, blockers)",
      "",
      "Format as bullet points. Be brief but complete — this is the ONLY context the model will have when resuming.",
      "",
      "Conversation:",
      conversationText,
    ].join("\n");

    let summary = "";

    // Use the resolved provider to generate the summary
    if (this.resolvedProvider) {
      try {
        for await (const event of this.resolvedProvider.provider.stream(
          [{ role: "user", content: summaryPrompt }],
          "You are a conversation summarizer. Output only the summary.",
          [],
        )) {
          if (event.type === "text") {
            summary += event.content;
          }
        }
      } catch {
        // Fallback: mechanical summary from last few messages
        summary = messages.slice(-6).map((m) => {
          const content = typeof m.content === "string" ? m.content : "";
          return `- [${m.role}] ${content.slice(0, 150)}`;
        }).join("\n");
      }
    }

    if (!summary.trim()) {
      summary = "Session was active but summary generation failed. Ask the user for context.";
    }

    // Clear context and inject the summary as the starting point
    this.contextEngine.clear();
    this.contextEngine.ingest({
      role: "user",
      content: `[Session compacted — previous context summarized below]\n\n${summary.trim()}\n\n---\nThe session was compacted by the user. Continue from where you left off. You have full context above.`,
      _compacted: true,
    });

    // Save the compacted session
    if (this.currentSession) {
      await this.sessionStore.saveMessages(this.currentSession.id, this.contextEngine.getMessages());
    }

    return summary.trim();
  }

  /** Destroy the engine and clean up */
  destroy(): void {
    this.cancel();
    this.removeAllListeners();
  }
}
