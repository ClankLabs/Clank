/**
 * Anthropic Claude provider.
 *
 * Uses the Messages API with SSE streaming. Cloud-only — used as a
 * fallback when local models can't handle a task, or when the user
 * explicitly configures a Claude model.
 */

import {
  BaseProvider,
  type Message,
  type StreamEvent,
  type ToolDefinition,
  type ContentBlock,
} from "./types.js";

const CONTEXT_WINDOWS: Record<string, number> = {
  "claude-opus-4-6": 200000,
  "claude-sonnet-4-6": 200000,
  "claude-haiku-4-5": 200000,
  "claude-sonnet-4-5": 200000,
};

export class AnthropicProvider extends BaseProvider {
  readonly name = "anthropic";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(opts: { apiKey: string; model: string; baseUrl?: string }) {
    super();
    this.apiKey = opts.apiKey;
    this.model = opts.model;
    this.baseUrl = opts.baseUrl || "https://api.anthropic.com";
  }

  contextWindow(): number {
    return CONTEXT_WINDOWS[this.model] ?? 200000;
  }

  formatTools(tools: ToolDefinition[]): unknown[] {
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /**
   * Merge consecutive same-role messages.
   * Anthropic's API requires alternating user/assistant roles.
   */
  private prepareMessages(messages: Message[]): Array<Record<string, unknown>> {
    const result: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      if (msg.role === "system") continue; // System goes in separate param

      if (msg.role === "tool") {
        // Tool results become user messages with tool_result content blocks
        const block = {
          type: "tool_result",
          tool_use_id: msg.tool_call_id,
          content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content),
        };

        const last = result[result.length - 1];
        if (last && last.role === "user") {
          (last.content as unknown[]).push(block);
        } else {
          result.push({ role: "user", content: [block] });
        }
        continue;
      }

      if (msg.role === "assistant" && msg.tool_calls) {
        // Assistant with tool calls → tool_use content blocks
        const content: unknown[] = [];
        if (typeof msg.content === "string" && msg.content) {
          content.push({ type: "text", text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          content.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input: JSON.parse(tc.function.arguments),
          });
        }
        result.push({ role: "assistant", content });
        continue;
      }

      // Regular text message — merge with previous if same role
      const textContent = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
      const last = result[result.length - 1];
      if (last && last.role === msg.role) {
        if (typeof last.content === "string") {
          last.content = last.content + "\n" + textContent;
        } else {
          (last.content as unknown[]).push({ type: "text", text: textContent });
        }
      } else {
        result.push({ role: msg.role, content: textContent });
      }
    }

    return result;
  }

  async *stream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: this.prepareMessages(messages),
      max_tokens: 8192,
      stream: true,
    };

    if (systemPrompt) {
      body.system = systemPrompt;
    }

    if (tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    const effectiveSignal = signal || AbortSignal.timeout(90_000);

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }

    if (!res.body) throw new Error("No response body from Anthropic");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let currentToolId = "";
    let currentToolName = "";
    let currentToolArgs = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data: ")) continue;

          const data = trimmed.slice(6);
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data) as Record<string, unknown>;
            const eventType = event.type as string;

            if (eventType === "content_block_start") {
              const block = event.content_block as Record<string, unknown>;
              if (block?.type === "tool_use") {
                currentToolId = block.id as string;
                currentToolName = block.name as string;
                currentToolArgs = "";
              }
            }

            if (eventType === "content_block_delta") {
              const delta = event.delta as Record<string, unknown>;
              if (delta?.type === "text_delta") {
                yield { type: "text", content: delta.text as string };
              }
              if (delta?.type === "thinking_delta") {
                yield { type: "thinking", content: delta.thinking as string };
              }
              if (delta?.type === "input_json_delta") {
                currentToolArgs += delta.partial_json as string;
              }
            }

            if (eventType === "content_block_stop") {
              if (currentToolId && currentToolName) {
                let parsedArgs: Record<string, unknown> = {};
                try {
                  parsedArgs = JSON.parse(currentToolArgs) as Record<string, unknown>;
                } catch {
                  parsedArgs = {};
                }
                yield {
                  type: "tool_call",
                  id: currentToolId,
                  name: currentToolName,
                  arguments: parsedArgs,
                };
                currentToolId = "";
                currentToolName = "";
                currentToolArgs = "";
              }
            }

            if (eventType === "message_delta") {
              const usage = (event as Record<string, unknown>).usage as Record<string, number> | undefined;
              if (usage) {
                yield {
                  type: "usage",
                  promptTokens: usage.input_tokens ?? 0,
                  outputTokens: usage.output_tokens ?? 0,
                };
              }
            }

            if (eventType === "message_stop") {
              yield { type: "done" };
              return;
            }
          } catch {
            // Skip malformed events
          }
        }
      }
    } finally {
      reader.releaseLock();
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
      content: [
        { type: "tool_use", id: toolCallId, name, input: args } as ContentBlock,
      ],
    };
  }

  formatToolResult(
    toolCallId: string,
    _name: string,
    result: string,
    isError?: boolean,
  ): Message {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          id: toolCallId,
          content: result,
          is_error: isError,
        } as ContentBlock,
      ],
    };
  }
}
