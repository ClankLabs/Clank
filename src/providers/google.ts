/**
 * Google Gemini provider.
 *
 * Uses the Generative AI REST API with streaming.
 * Supports Gemini 2.0 Flash (1M context) and Gemini 1.5 Pro (2M context).
 */

import {
  BaseProvider,
  type Message,
  type StreamEvent,
  type ToolDefinition,
} from "./types.js";

const CONTEXT_WINDOWS: Record<string, number> = {
  "gemini-2.0-flash": 1048576,
  "gemini-1.5-flash": 1048576,
  "gemini-1.5-pro": 2097152,
};

/** Map JSON Schema types to Gemini's uppercase types */
function mapType(type: string): string {
  const MAP: Record<string, string> = {
    string: "STRING", number: "NUMBER", integer: "INTEGER",
    boolean: "BOOLEAN", array: "ARRAY", object: "OBJECT",
  };
  return MAP[type] || "STRING";
}

export class GoogleProvider extends BaseProvider {
  readonly name = "google";
  private apiKey: string;
  private model: string;

  constructor(opts: { apiKey: string; model: string }) {
    super();
    this.apiKey = opts.apiKey;
    this.model = opts.model;
  }

  contextWindow(): number {
    return CONTEXT_WINDOWS[this.model] ?? 1048576;
  }

  formatTools(tools: ToolDefinition[]): unknown[] {
    return [{
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: convertSchema(t.parameters),
      })),
    }];
  }

  /**
   * Prepare messages for Gemini API.
   * Gemini uses "user" and "model" roles, and requires alternation.
   */
  private prepareContents(messages: Message[]): Array<Record<string, unknown>> {
    const contents: Array<Record<string, unknown>> = [];

    for (const msg of messages) {
      if (msg.role === "system") continue;

      const role = msg.role === "assistant" ? "model" : "user";
      const text = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

      if (msg.role === "tool") {
        // Tool results as function responses
        contents.push({
          role: "function",
          parts: [{
            functionResponse: {
              name: msg.tool_call_id || "unknown",
              response: { content: text },
            },
          }],
        });
        continue;
      }

      if (msg.role === "assistant" && msg.tool_calls) {
        // Assistant with tool calls
        const parts: unknown[] = [];
        if (text) parts.push({ text });
        for (const tc of msg.tool_calls) {
          parts.push({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
            },
          });
        }
        contents.push({ role: "model", parts });
        continue;
      }

      // Merge consecutive same-role messages
      const last = contents[contents.length - 1];
      if (last && last.role === role) {
        (last.parts as unknown[]).push({ text });
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }

    return contents;
  }

  async *stream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent> {
    const contents = this.prepareContents(messages);

    const body: Record<string, unknown> = { contents };

    if (systemPrompt) {
      body.systemInstruction = { parts: [{ text: systemPrompt }] };
    }

    if (tools.length > 0) {
      body.tools = this.formatTools(tools);
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?key=${this.apiKey}&alt=sse`;

    const effectiveSignal = signal || AbortSignal.timeout(90_000);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: effectiveSignal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Google API error ${res.status}: ${text}`);
    }

    if (!res.body) throw new Error("No response body from Google");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

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

          try {
            const data = JSON.parse(trimmed.slice(6)) as {
              candidates?: Array<{
                content?: {
                  parts?: Array<{
                    text?: string;
                    functionCall?: { name: string; args: Record<string, unknown> };
                  }>;
                };
              }>;
              usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
            };

            const parts = data.candidates?.[0]?.content?.parts || [];
            for (const part of parts) {
              if (part.text) {
                yield { type: "text", content: part.text };
              }
              if (part.functionCall) {
                yield {
                  type: "tool_call",
                  id: `google_${Date.now()}`,
                  name: part.functionCall.name,
                  arguments: part.functionCall.args,
                };
              }
            }

            if (data.usageMetadata) {
              yield {
                type: "usage",
                promptTokens: data.usageMetadata.promptTokenCount ?? 0,
                outputTokens: data.usageMetadata.candidatesTokenCount ?? 0,
              };
            }
          } catch {
            // Skip malformed chunks
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
      content: "",
      tool_calls: [{
        id: toolCallId,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      }],
    };
  }

  formatToolResult(
    toolCallId: string,
    name: string,
    result: string,
    _isError?: boolean,
  ): Message {
    return {
      role: "tool",
      content: result,
      tool_call_id: name, // Gemini uses function name as ID
    };
  }
}

/** Convert JSON Schema to Gemini's format */
function convertSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (schema.type) result.type = mapType(schema.type as string);
  if (schema.description) result.description = schema.description;
  if (schema.required) result.required = schema.required;

  if (schema.properties) {
    result.properties = {};
    for (const [key, value] of Object.entries(schema.properties as Record<string, Record<string, unknown>>)) {
      (result.properties as Record<string, unknown>)[key] = convertSchema(value);
    }
  }

  if (schema.items) {
    result.items = convertSchema(schema.items as Record<string, unknown>);
  }

  return result;
}
