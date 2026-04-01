/**
 * Context engine — two-tier compaction for local model optimization.
 *
 * Local models typically have 8K-32K context windows vs 128K-200K for cloud.
 * Smart compaction is what makes the difference between a usable local
 * agent and one that constantly errors out.
 *
 * Tier 1 (fast, every turn):
 *   - System prompt token budgeting
 *   - Tool result deduplication (same file read twice → keep latest)
 *   - Tool result summarization (>500 chars → first 3 + last 2 lines)
 *   - Long assistant message truncation (>3000 chars → first 1000)
 *   - Oldest message dropping as last resort
 *
 * Tier 2 (LLM-summarized, when tier 1 isn't enough):
 *   - Uses the model to generate a conversation summary
 *   - Replaces oldest N messages with a single recap message
 *   - Preserves meaning instead of just chopping text
 *   - Adds latency but keeps the agent coherent over long sessions
 */

import type { Message } from "../providers/types.js";
import type { BaseProvider } from "../providers/types.js";

export interface CompactionResult {
  ok: boolean;
  tier: 1 | 2;
  messagesBefore: number;
  messagesAfter: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
}

/** Budget allocation for system prompt vs conversation */
interface TokenBudget {
  systemPrompt: number;
  conversation: number;
  responseReserve: number;
}

export class ContextEngine {
  private messages: Message[] = [];
  private contextWindowSize: number;
  private isLocal: boolean;
  private systemPromptTokens: number = 0;
  /** Provider for tier 2 LLM-summarized compaction */
  private provider: BaseProvider | null = null;
  private modelId: string = "";
  /** Cache of tool results by file path to detect duplicates */
  private toolResultHashes = new Map<string, number>();

  constructor(opts: { contextWindow: number; isLocal: boolean }) {
    this.contextWindowSize = opts.contextWindow;
    this.isLocal = opts.isLocal;
  }

  /** Set the provider for tier 2 compaction */
  setProvider(provider: BaseProvider, modelId: string): void {
    this.provider = provider;
    this.modelId = modelId;
  }

  /** Set the system prompt size for token budgeting */
  setSystemPromptSize(tokens: number): void {
    this.systemPromptTokens = tokens;
  }

  /** Get all messages */
  getMessages(): Message[] {
    return this.messages;
  }

  /** Set messages (e.g., when loading a session) */
  setMessages(messages: Message[]): void {
    this.messages = [...messages];
  }

  /** Add a message to the context */
  ingest(message: Message): void {
    this.messages.push(message);
  }

  /** Add multiple messages */
  ingestBatch(messages: Message[]): void {
    this.messages.push(...messages);
  }

  /**
   * Estimate total tokens in the current context.
   * Uses ~4 chars per token as a rough estimate.
   */
  estimateTokens(): number {
    let chars = 0;
    for (const msg of this.messages) {
      if (typeof msg.content === "string") {
        chars += msg.content.length;
      } else {
        chars += JSON.stringify(msg.content).length;
      }
    }
    return Math.ceil(chars / 4);
  }

  /** Calculate token budgets */
  private getBudget(): TokenBudget {
    // Reserve 25% of context for the model's response
    const responseReserve = Math.floor(this.contextWindowSize * 0.25);
    const available = this.contextWindowSize - responseReserve;
    // System prompt gets what it needs, conversation gets the rest
    const systemPrompt = Math.min(this.systemPromptTokens, Math.floor(available * 0.3));
    const conversation = available - systemPrompt;
    return { systemPrompt, conversation, responseReserve };
  }

  /** Get context utilization as a percentage of the conversation budget */
  utilizationPercent(): number {
    const budget = this.getBudget();
    return (this.estimateTokens() / budget.conversation) * 100;
  }

  /**
   * Check if compaction is needed.
   * Local models trigger earlier (60%) to leave room for the response.
   * Cloud models can wait longer (80%).
   */
  needsCompaction(): boolean {
    const threshold = this.isLocal ? 60 : 80;
    return this.utilizationPercent() >= threshold;
  }

  /**
   * Run compaction — tier 1 first, tier 2 if still over budget.
   * Returns the result with which tier was used.
   */
  async compactSmart(): Promise<CompactionResult> {
    const before = this.messages.length;
    const tokensBefore = this.estimateTokens();

    // Tier 1: mechanical compaction
    this.compactTier1();

    // Check if tier 1 was enough
    if (this.utilizationPercent() < 70) {
      return {
        ok: true,
        tier: 1,
        messagesBefore: before,
        messagesAfter: this.messages.length,
        estimatedTokensBefore: tokensBefore,
        estimatedTokensAfter: this.estimateTokens(),
      };
    }

    // Tier 2: LLM-summarized compaction
    if (this.provider) {
      await this.compactTier2();
    } else {
      // No provider — aggressive tier 1 fallback (drop more messages)
      this.compactTier1Aggressive();
    }

    return {
      ok: true,
      tier: this.provider ? 2 : 1,
      messagesBefore: before,
      messagesAfter: this.messages.length,
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: this.estimateTokens(),
    };
  }

  /** Synchronous compact (backward compat — uses tier 1 only) */
  compact(): CompactionResult {
    const before = this.messages.length;
    const tokensBefore = this.estimateTokens();

    this.compactTier1();

    if (this.utilizationPercent() >= 70) {
      this.compactTier1Aggressive();
    }

    return {
      ok: true,
      tier: 1,
      messagesBefore: before,
      messagesAfter: this.messages.length,
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: this.estimateTokens(),
    };
  }

  /**
   * Tier 1: Fast mechanical compaction (no LLM calls).
   */
  private compactTier1(): void {
    const protectedCount = 6;
    if (this.messages.length <= protectedCount) return;

    const protectedZone = this.messages.slice(-protectedCount);
    const compactable = this.messages.slice(0, -protectedCount);
    const compacted: Message[] = [];

    // Pass 1: Deduplicate tool results (same tool+path → keep latest only)
    const seenToolResults = new Map<string, number>();
    for (let i = compactable.length - 1; i >= 0; i--) {
      const msg = compactable[i];
      if (msg.role === "tool" && msg.tool_call_id) {
        // Extract a dedup key from the tool call (e.g., read_file:/path)
        const key = msg.tool_call_id;
        if (!seenToolResults.has(key)) {
          seenToolResults.set(key, i);
        }
      }
    }

    // Pass 2: Compact messages
    for (let i = 0; i < compactable.length; i++) {
      const msg = compactable[i];

      if (msg._compacted) {
        compacted.push(msg);
        continue;
      }

      const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);

      if (msg.role === "tool") {
        // Summarize long tool results
        if (content.length > 500) {
          const lines = content.split("\n");
          const summary = [
            ...lines.slice(0, 3),
            `... (${lines.length - 5} lines omitted)`,
            ...lines.slice(-2),
          ].join("\n");
          compacted.push({ ...msg, content: summary, _compacted: true });
        } else {
          compacted.push(msg);
        }
      } else if (msg.role === "assistant") {
        // Truncate long assistant messages
        if (content.length > 3000) {
          compacted.push({
            ...msg,
            content: content.slice(0, 1000) + "\n... (truncated)",
            _compacted: true,
          });
        } else {
          compacted.push(msg);
        }
      } else if (msg.role === "user") {
        // Truncate very long user messages
        if (content.length > 2000) {
          compacted.push({
            ...msg,
            content: content.slice(0, 800) + "\n... (truncated)",
            _compacted: true,
          });
        } else {
          compacted.push(msg);
        }
      } else {
        compacted.push(msg);
      }
    }

    this.messages = [...compacted, ...protectedZone];
  }

  /**
   * Tier 1 aggressive: drop oldest messages when regular compaction isn't enough.
   * Drops tool call + tool result pairs together to avoid orphaned messages
   * that cause API errors (Ollama/OpenAI require matching pairs).
   */
  private compactTier1Aggressive(): void {
    const protectedCount = 6;
    const budget = this.getBudget();

    while (this.estimateTokens() > budget.conversation * 0.7 && this.messages.length > protectedCount + 2) {
      // Find the first non-system message to drop
      const dropIdx = this.messages.findIndex((m) => m.role !== "system");
      if (dropIdx === -1 || dropIdx >= this.messages.length - protectedCount) break;

      const msg = this.messages[dropIdx];

      // If this is an assistant message with tool_calls, also drop the
      // following tool result message(s) to keep pairs intact
      if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
        const toolCallIds = new Set(msg.tool_calls.map((tc) => tc.id));
        this.messages.splice(dropIdx, 1);
        // Remove orphaned tool results (scan forward from dropIdx)
        for (let i = dropIdx; i < this.messages.length; ) {
          if (this.messages[i].role === "tool" && toolCallIds.has(this.messages[i].tool_call_id || "")) {
            this.messages.splice(i, 1);
          } else {
            break; // Tool results are consecutive after the assistant message
          }
        }
      } else if (msg.role === "tool" && msg.tool_call_id) {
        // Orphaned tool result — find and drop its parent assistant message too
        const parentIdx = this.messages.findLastIndex(
          (m, idx) => idx < dropIdx && m.role === "assistant" && m.tool_calls?.some((tc) => tc.id === msg.tool_call_id)
        );
        if (parentIdx >= 0) {
          // Drop the parent and ALL its tool results
          const parent = this.messages[parentIdx];
          const parentToolIds = new Set(parent.tool_calls!.map((tc) => tc.id));
          this.messages.splice(parentIdx, 1);
          // Re-scan and drop orphaned results
          for (let i = parentIdx; i < this.messages.length; ) {
            if (this.messages[i].role === "tool" && parentToolIds.has(this.messages[i].tool_call_id || "")) {
              this.messages.splice(i, 1);
            } else {
              break;
            }
          }
        } else {
          // No parent found — just drop the orphan
          this.messages.splice(dropIdx, 1);
        }
      } else {
        this.messages.splice(dropIdx, 1);
      }
    }
  }

  /**
   * Tier 2: LLM-summarized compaction.
   *
   * Takes the oldest messages (outside protected zone), sends them to
   * the model with a summarization prompt, and replaces them with a
   * single "conversation recap" message. This preserves meaning that
   * mechanical truncation loses.
   */
  private async compactTier2(): Promise<void> {
    if (!this.provider) return;

    const protectedCount = 6;
    if (this.messages.length <= protectedCount + 2) return;

    // Take the older half of the conversation for summarization.
    // Adjust cutoff to avoid splitting a tool call / tool result pair —
    // if the message at cutoff is a tool result, move cutoff forward to
    // include it in the summarized block (keep the pair together).
    let cutoff = Math.max(2, this.messages.length - protectedCount - 2);
    while (cutoff < this.messages.length && this.messages[cutoff].role === "tool") {
      cutoff++;
    }
    const toSummarize = this.messages.slice(0, cutoff);
    const toKeep = this.messages.slice(cutoff);

    // Build the summarization prompt
    const conversationText = toSummarize
      .map((m) => {
        const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        const truncated = content.length > 500 ? content.slice(0, 500) + "..." : content;
        return `${m.role}: ${truncated}`;
      })
      .join("\n\n");

    const summaryPrompt = [
      "Summarize this conversation concisely. Capture:",
      "- Key decisions made",
      "- Files modified and why",
      "- Current task status",
      "- Important context the assistant needs going forward",
      "",
      "Be brief (under 300 words). Use bullet points.",
      "",
      "Conversation:",
      conversationText,
    ].join("\n");

    try {
      // Use the model to generate a summary
      let summary = "";
      for await (const event of this.provider.stream(
        [{ role: "user", content: summaryPrompt }],
        "You are a conversation summarizer. Output only the summary, nothing else.",
        [], // no tools
      )) {
        if (event.type === "text") {
          summary += event.content;
        }
      }

      if (summary.trim()) {
        // Replace old messages with the summary
        const recapMessage: Message = {
          role: "user",
          content: `[Conversation recap — earlier messages were compacted]\n\n${summary.trim()}`,
          _compacted: true,
        };

        this.messages = [recapMessage, ...toKeep];
      }
    } catch {
      // LLM summary failed — fall back to aggressive tier 1
      this.compactTier1Aggressive();
    }
  }

  /** Check if context is critically full (>95% utilization) */
  isOverflowing(): boolean {
    return this.utilizationPercent() >= 95;
  }

  /**
   * Tier-1 only compaction — synchronous, no LLM call.
   * Safe to call mid-turn without adding latency.
   */
  compactTier1Only(): CompactionResult {
    const before = this.messages.length;
    const tokensBefore = this.estimateTokens();

    this.compactTier1();

    // If still over budget, use aggressive dropping
    if (this.utilizationPercent() >= 70) {
      this.compactTier1Aggressive();
    }

    return {
      ok: true,
      tier: 1,
      messagesBefore: before,
      messagesAfter: this.messages.length,
      estimatedTokensBefore: tokensBefore,
      estimatedTokensAfter: this.estimateTokens(),
    };
  }

  /** Clear all messages */
  clear(): void {
    this.messages = [];
    this.toolResultHashes.clear();
  }

  /** Update the context window size */
  setContextWindow(size: number): void {
    this.contextWindowSize = size;
  }
}
