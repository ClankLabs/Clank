/**
 * Ollama provider — the primary provider for Clank.
 *
 * Uses the OpenAI-compatible API that Ollama exposes at /v1/.
 * Key local-model optimizations:
 * - Dynamic context window detection via /api/show
 * - Tool support checking against known model patterns
 * - Response token capping for smaller models
 */

import {
  BaseProvider,
  type Message,
  type StreamEvent,
  type ToolDefinition,
} from "./types.js";

/** Models known to support native tool calling */
const TOOL_CAPABLE_PATTERNS = [
  /^llama3\.[1-9]/i,
  /^llama-3\.[1-9]/i,
  /^qwen[23]/i,
  /^mistral-nemo/i,
  /^mistral-large/i,
  /^command-r/i,
  /^firefunction/i,
  /^hermes-[23]/i,
  /^nemotron/i,
];

/** Cache for context window sizes per model */
const contextWindowCache = new Map<string, number>();

export class OllamaProvider extends BaseProvider {
  readonly name = "ollama";
  private baseUrl: string;
  private model: string;
  private maxResponseTokens?: number;

  constructor(opts: {
    baseUrl?: string;
    model: string;
    maxResponseTokens?: number;
  }) {
    super();
    this.baseUrl = (opts.baseUrl || "http://127.0.0.1:11434").replace(/\/$/, "");
    this.model = opts.model;
    this.maxResponseTokens = opts.maxResponseTokens;
  }

  /**
   * Auto-detect Ollama by probing /api/tags.
   * Returns the list of available models, or null if Ollama isn't running.
   */
  static async detect(baseUrl = "http://127.0.0.1:11434"): Promise<string[] | null> {
    try {
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const data = (await res.json()) as { models?: Array<{ name: string }> };
      return data.models?.map((m) => m.name) ?? [];
    } catch {
      return null;
    }
  }

  /**
   * Detect the context window for a model via /api/show.
   * Caches the result since this doesn't change at runtime.
   */
  async detectContextWindow(): Promise<number> {
    const cached = contextWindowCache.get(this.model);
    if (cached) return cached;

    try {
      const res = await fetch(`${this.baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: this.model }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return 32768;

      const data = (await res.json()) as {
        model_info?: Record<string, unknown>;
        parameters?: string;
      };

      // Check model_info for context length keys
      if (data.model_info) {
        for (const [key, value] of Object.entries(data.model_info)) {
          if (
            key.includes("context_length") ||
            key.includes("context_window") ||
            key.includes("num_ctx")
          ) {
            const ctx = Number(value);
            if (ctx > 0) {
              contextWindowCache.set(this.model, ctx);
              return ctx;
            }
          }
        }
      }

      // Check parameters string for num_ctx
      if (data.parameters) {
        const match = data.parameters.match(/num_ctx\s+(\d+)/);
        if (match) {
          const ctx = parseInt(match[1], 10);
          contextWindowCache.set(this.model, ctx);
          return ctx;
        }
      }
    } catch {
      // Fall through to default
    }

    const defaultCtx = 32768;
    contextWindowCache.set(this.model, defaultCtx);
    return defaultCtx;
  }

  /** Check if a model supports native tool calling */
  static supportsTools(model: string): boolean {
    const baseName = model.split(":")[0];
    return TOOL_CAPABLE_PATTERNS.some((p) => p.test(baseName));
  }

  contextWindow(): number {
    return contextWindowCache.get(this.model) ?? 32768;
  }

  formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      type: "function",
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  async *stream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    // Build OpenAI-compatible messages array
    const apiMessages: Array<Record<string, unknown>> = [];

    if (systemPrompt) {
      apiMessages.push({ role: "system", content: systemPrompt });
    }

    for (const msg of messages) {
      if (msg.role === "tool") {
        apiMessages.push({
          role: "tool",
          tool_call_id: msg.tool_call_id,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        });
      } else if (msg.role === "assistant" && msg.tool_calls) {
        apiMessages.push({
          role: "assistant",
          content: typeof msg.content === "string" ? msg.content : null,
          tool_calls: msg.tool_calls,
        });
      } else {
        apiMessages.push({
          role: msg.role,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        });
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: apiMessages,
      stream: true,
    };

    if (tools.length > 0 && OllamaProvider.supportsTools(this.model)) {
      body.tools = this.formatTools(tools);
    }

    if (this.maxResponseTokens) {
      body.max_tokens = this.maxResponseTokens;
    }

    // Use the caller's abort signal if provided, otherwise apply a 120s timeout
    // so the gateway doesn't hang forever if the model is unresponsive
    const effectiveSignal = signal || AbortSignal.timeout(120_000);

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    if (!res.body) {
      throw new Error("No response body from Ollama");
    }

    // Parse SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") {
            // Emit any accumulated tool calls
            for (const tc of toolCalls.values()) {
              let parsedArgs: Record<string, unknown> = {};
              try {
                parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;
              } catch {
                parsedArgs = {};
              }
              yield { type: "tool_call", id: tc.id, name: tc.name, arguments: parsedArgs };
            }
            yield { type: "done" };
            return;
          }

          try {
            const chunk = JSON.parse(data) as {
              choices?: Array<{
                delta?: {
                  content?: string | null;
                  tool_calls?: Array<{
                    index: number;
                    id?: string;
                    function?: { name?: string; arguments?: string };
                  }>;
                };
                finish_reason?: string | null;
              }>;
              usage?: {
                prompt_tokens?: number;
                completion_tokens?: number;
              };
            };

            const choice = chunk.choices?.[0];
            if (!choice) continue;

            // Text content
            if (choice.delta?.content) {
              yield { type: "text", content: choice.delta.content };
            }

            // Tool calls (accumulated across chunks)
            if (choice.delta?.tool_calls) {
              for (const tc of choice.delta.tool_calls) {
                const existing = toolCalls.get(tc.index);
                if (existing) {
                  if (tc.function?.arguments) {
                    existing.arguments += tc.function.arguments;
                  }
                } else {
                  toolCalls.set(tc.index, {
                    id: tc.id || `call_${tc.index}`,
                    name: tc.function?.name || "",
                    arguments: tc.function?.arguments || "",
                  });
                }
              }
            }

            // Usage info
            if (chunk.usage) {
              yield {
                type: "usage",
                promptTokens: chunk.usage.prompt_tokens ?? 0,
                outputTokens: chunk.usage.completion_tokens ?? 0,
              };
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // If we exit without [DONE], still emit pending tool calls and done
    for (const tc of toolCalls.values()) {
      let parsedArgs: Record<string, unknown> = {};
      try {
        parsedArgs = JSON.parse(tc.arguments) as Record<string, unknown>;
      } catch {
        parsedArgs = {};
      }
      yield { type: "tool_call", id: tc.id, name: tc.name, arguments: parsedArgs };
    }
    yield { type: "done" };
  }

  formatAssistantToolUse(
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
  ): Message {
    return {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: toolCallId,
          type: "function",
          function: { name, arguments: JSON.stringify(args) },
        },
      ],
    };
  }

  formatToolResult(
    toolCallId: string,
    _name: string,
    result: string,
    _isError?: boolean,
  ): Message {
    return {
      role: "tool",
      content: result,
      tool_call_id: toolCallId,
    };
  }
}
