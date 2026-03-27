/**
 * Tool system type definitions.
 *
 * Tools are the agent's hands — they let it read files, write code,
 * run commands, search the web, etc. Each tool has a safety level
 * that controls whether it needs user confirmation before executing.
 */

/** Safety classification for tools */
export type SafetyLevel = "low" | "medium" | "high";

/** Context passed to tool execute/validate */
export interface ToolContext {
  /** Working directory for file operations */
  projectRoot: string;
  /** Whether external paths are allowed */
  allowExternal?: boolean;
  /** Auto-approve settings per safety level */
  autoApprove: { low: boolean; medium: boolean; high: boolean };
  /** Agent ID (for scoping) */
  agentId?: string;
  /** Abort signal */
  signal?: AbortSignal;
  /** Task registry for background task management */
  taskRegistry?: import("../tasks/registry.js").TaskRegistry;
  /** Spawn a background task (only available to agents within depth limit) */
  spawnTask?: (opts: {
    agentId: string;
    prompt: string;
    label: string;
    timeoutMs: number;
  }) => Promise<string>;
  /** Current spawn depth of this agent (0 = main) */
  spawnDepth?: number;
  /** Maximum allowed spawn depth */
  maxSpawnDepth?: number;
  /** Session key of this agent */
  sessionKey?: string;
  /** Kill a running task by ID */
  killTask?: (taskId: string) => Promise<{ status: string; cascadeKilled?: number }>;
  /** Send a message to a running child task's engine */
  messageTask?: (taskId: string, message: string) => Promise<{ status: string; replyText?: string }>;
}

/** Validation result from tool.validate() */
export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/** The interface every tool must implement */
export interface Tool {
  /** Tool definition sent to the LLM */
  definition: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, unknown>;
      required?: string[];
    };
  };

  /** Safety classification — determines if user confirmation is needed */
  safetyLevel: SafetyLevel | ((args: Record<string, unknown>) => SafetyLevel);

  /** Whether this tool only reads data (safe in plan mode) */
  readOnly: boolean;

  /** Validate arguments before execution */
  validate(args: Record<string, unknown>, context: ToolContext): ValidationResult;

  /** Execute the tool and return a string result */
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;

  /** Human-readable confirmation message for the action */
  formatConfirmation?(args: Record<string, unknown>): string;
}

/** Tool tier for local model optimization */
export type ToolTier = "full" | "core" | "auto";

/** Keywords that trigger dynamic tool injection in "auto" tier */
export const AUTO_TIER_TRIGGERS: Record<string, string[]> = {
  npm_install: ["install", "npm", "package", "dependency"],
  pip_install: ["pip", "python package", "pip install"],
  install_tool: ["install", "winget", "choco", "brew", "apt"],
  generate_file: ["generate", "pdf", "create file", "export"],
};

/** Core tools available at all tiers */
export const CORE_TOOL_NAMES = [
  "read_file",
  "write_file",
  "edit_file",
  "list_directory",
  "search_files",
  "glob_files",
  "bash",
  "git",
  "web_search",
  "web_fetch",
];
