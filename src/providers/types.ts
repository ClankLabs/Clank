/**
 * Provider type definitions.
 *
 * All providers return the same stream event format regardless of the
 * underlying API. This abstraction lets the agent engine treat Ollama,
 * Anthropic, OpenAI, and Google identically.
 */

/** Events yielded by provider.stream() */
export type StreamEvent =
  | { type: "text"; content: string }
  | { type: "thinking"; content: string }
  | { type: "tool_call"; id: string; name: string; arguments: Record<string, unknown> }
  | { type: "usage"; promptTokens: number; outputTokens: number; evalDurationNs?: number }
  | { type: "done" };

/** Tool definition in the format passed to providers */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** Message in conversation history */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentBlock[];
  /** For tool result messages */
  tool_call_id?: string;
  /** For assistant messages with tool calls */
  tool_calls?: ToolCallMessage[];
  /** Marks messages that have been compacted */
  _compacted?: boolean;
}

export interface ContentBlock {
  type: "text" | "image" | "tool_use" | "tool_result";
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  is_error?: boolean;
}

export interface ToolCallMessage {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Per-model compatibility config.
 *
 * Different models (especially local ones) have quirks — some don't support
 * tools natively, some need different thinking formats, some have weird
 * max_tokens field names. This config lets us handle all of that.
 */
export interface ModelCompatConfig {
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsImages?: boolean;
  /** How thinking/reasoning blocks are formatted */
  thinkingFormat?: "anthropic" | "openai" | "qwen" | "none";
  /** Field name for max output tokens */
  maxTokensField?: "max_tokens" | "max_completion_tokens";
  /** Some models need tool result messages to include the tool name */
  requiresToolResultName?: boolean;
  /** Some models need an assistant message after tool results */
  requiresAssistantAfterToolResult?: boolean;
  /** Max output tokens override */
  maxOutputTokens?: number;
}

/** Provider resolution result from the router */
export interface ResolvedProvider {
  provider: BaseProvider;
  providerName: string;
  modelId: string;
  isLocal: boolean;
}

/** Model entry in config */
export interface ModelConfig {
  primary: string;
  fallbacks?: string[];
  temperature?: number;
  maxResponseTokens?: number;
}

/**
 * Models known to support native tool/function calling via the API.
 * Models NOT in this list should use PromptFallbackProvider instead,
 * which injects tools into the system prompt as text.
 */
const TOOL_CAPABLE_PATTERNS = [
  /^wrench/i,
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

/**
 * Check if a model name is known to support native tool calling.
 * Used by the agent engine to decide whether to use API-level tools
 * or the prompt-based fallback for local models.
 */
export function supportsNativeTools(model: string): boolean {
  // Strip provider prefix (e.g., "ollama/qwen3.5" → "qwen3.5")
  const name = model.includes("/") ? model.split("/").pop()! : model;
  // Strip quantization/tag suffix (e.g., "llama3.1:8b-q4" → "llama3.1")
  const baseName = name.split(":")[0];
  return TOOL_CAPABLE_PATTERNS.some((p) => p.test(baseName));
}

/**
 * Base provider interface.
 *
 * Every LLM provider (Ollama, Anthropic, OpenAI, Google) implements this.
 * The stream() method is an async generator that yields StreamEvents,
 * giving the agent engine a unified interface regardless of backend.
 */
export abstract class BaseProvider {
  abstract readonly name: string;

  /** Convert tool definitions to the provider's native format */
  abstract formatTools(tools: ToolDefinition[]): unknown[];

  /**
   * Stream a completion from the model.
   * Yields StreamEvents in a normalized format.
   */
  abstract stream(
    messages: Message[],
    systemPrompt: string,
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): AsyncGenerator<StreamEvent>;

  /** Rough token estimate (~4 chars per token) */
  estimateTokens(messages: Message[]): number {
    const text = messages
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("");
    return Math.ceil(text.length / 4);
  }

  /** Max context window size in tokens */
  abstract contextWindow(): number;

  /** Format an assistant tool use for message history */
  abstract formatAssistantToolUse(
    toolCallId: string,
    name: string,
    args: Record<string, unknown>,
  ): Message;

  /** Format a tool result for message history */
  abstract formatToolResult(
    toolCallId: string,
    name: string,
    result: string,
    isError?: boolean,
  ): Message;
}
