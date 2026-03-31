/**
 * System prompt builder.
 *
 * Assembles the system prompt from workspace files (SOUL.md, USER.md, etc.),
 * agent identity, runtime info, and tool descriptions. This is what gives
 * the agent its personality and context.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { platform, hostname } from "node:os";
import type { AgentIdentity } from "./agent.js";

/** Workspace files to load into the system prompt */
const WORKSPACE_FILES = [
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "AGENTS.md",
  "TOOLS.md",
  "MEMORY.md",
];

/** Workspace files for local models — skip MEMORY.md to save context tokens.
 *  Memory is injected separately via TF-IDF relevance matching instead. */
const WORKSPACE_FILES_LOCAL = [
  "SOUL.md",
  "USER.md",
  "IDENTITY.md",
  "AGENTS.md",
  "TOOLS.md",
];

/** Extra file loaded only for sub-agents (spawnDepth > 0) */
const SUB_AGENT_FILE = "RUNNER.md";

/**
 * Build the complete system prompt for an agent.
 */
export async function buildSystemPrompt(opts: {
  identity: AgentIdentity;
  workspaceDir: string;
  channel?: string;
  compact?: boolean;
  thinking?: "on" | "off" | "auto";
  spawnDepth?: number;
  isLocal?: boolean;
  canSpawn?: boolean;
}): Promise<string> {
  const parts: string[] = [];
  const compact = opts.compact ?? false;
  const isLocal = opts.isLocal ?? false;
  const isSubAgent = (opts.spawnDepth ?? 0) > 0;

  if (!compact) {
    // Full mode: load workspace files (SOUL.md, USER.md, etc.)
    // Local models skip MEMORY.md — memory is injected via TF-IDF relevance instead
    const files = isLocal ? WORKSPACE_FILES_LOCAL : WORKSPACE_FILES;
    const workspaceContent = await loadWorkspaceFiles(opts.workspaceDir, files);
    if (workspaceContent) {
      parts.push(workspaceContent);
      parts.push("---");
    }

    // Sub-agents get the RUNNER.md playbook for structured execution
    if (isSubAgent) {
      const runnerContent = await loadSingleFile(opts.workspaceDir, SUB_AGENT_FILE);
      if (runnerContent) {
        parts.push(runnerContent);
        parts.push("---");
      }
    }
  }

  // Runtime info (always included, brief in compact mode)
  if (compact) {
    parts.push(`Agent: ${opts.identity.name} | Model: ${opts.identity.model.primary} | Dir: ${opts.identity.workspace}`);
  } else {
    parts.push("## Runtime");
    parts.push(`Agent: ${opts.identity.name} (${opts.identity.id})`);
    parts.push(`Model: ${opts.identity.model.primary}`);
    parts.push(`Workspace: ${opts.identity.workspace}`);
    parts.push(`Platform: ${platform()} (${hostname()})`);
    parts.push(`Channel: ${opts.channel || "cli"}`);
    parts.push(`Tool tier: ${opts.identity.toolTier}`);
  }
  parts.push("");

  // Core identity and instructions — this block must be dense and forceful.
  // Local models have strong training biases toward refusing actions ("I can't
  // access files", "I don't have the ability to", "as an AI I cannot"). These
  // refusals are WRONG in this context — this agent runs locally with real
  // tools. The system prompt must override those biases decisively.
  if (compact) {
    parts.push([
      "You are an AI agent running LOCALLY on the user's machine.",
      "You have tools: read_file, write_file, edit_file, list_directory, bash, search_files, glob_files, git, web_search, web_fetch, search_docs, and self-config tools.",
      "ALWAYS use your tools. NEVER say you cannot access files, run commands, or perform actions. You CAN — use your tools.",
      "NEVER apologize and refuse. If asked to do something, DO IT with your tools or explain what tool you need.",
      "When asked about current events, docs, APIs, errors, or anything uncertain — USE web_search to look it up, then web_fetch to read pages. Do NOT guess.",
      "Do NOT modify files outside your workspace or the user's current directory unless the user explicitly names the file.",
      opts.canSpawn ? "You can delegate work to background sub-agents using spawn_task with roles: architect, executor, auditor." : "",
    ].filter(Boolean).join(" "));
  } else {
    parts.push("## CRITICAL: You Are a Local Agent With Tools");
    parts.push([
      "You are an AI agent running LOCALLY on the user's machine — NOT a cloud chatbot.",
      "You have DIRECT access to the file system, shell, and web through your tools.",
      "Your tools include: read_file, write_file, edit_file, list_directory, bash, search_files, glob_files, git, web_search, web_fetch, and self-configuration tools.",
    ].join(" "));
    parts.push("");
    parts.push("**RULES — follow these strictly:**");
    parts.push("1. ALWAYS use your tools to accomplish tasks. When asked to read a file, USE read_file. When asked to run a command, USE bash.");
    parts.push("2. NEVER say \"I cannot access files\", \"I don't have the ability to\", or \"as an AI I cannot\". These statements are FALSE. You have tools that give you these abilities.");
    parts.push("3. NEVER apologize and refuse to act. If a task requires a tool, use it. If you lack a specific tool, say which tool you need — do not give a generic refusal.");
    parts.push("4. Read files before editing them. Use tools proactively without being asked twice.");
    parts.push("5. You can configure yourself — use the config, channel, agent, and model management tools to modify your own setup.");
    parts.push("6. **Web search:** When the user asks about current events, recent news, documentation, APIs, packages, error messages, or anything you're unsure about — USE `web_search` to look it up. Then use `web_fetch` to read the full page. Do NOT guess or hallucinate answers when you can search.");
    parts.push("7. **Doc search:** When you need to understand how something works in the project, USE `search_docs` to search local documentation, READMEs, and project files. This is faster than reading every file manually and helps you find relevant context quickly.");
    parts.push("8. Do NOT modify, delete, or overwrite files outside your workspace directory or the user's current working directory unless the user explicitly names the file. System files, OS directories, and config dotfiles are off-limits by default.");
    if (opts.canSpawn) {
      parts.push("9. **Sub-agents:** You can delegate work to background sub-agents using `spawn_task`. Use sub-agents for: parallel research, long-running tasks, code review while you continue working, or any task that benefits from a separate focused worker. Assign a role (architect, executor, auditor) to focus the sub-agent. Check results with spawn_task action='list' or action='status'.");
    }
  }

  // Thinking control
  if (opts.thinking === "off") {
    parts.push("");
    parts.push("Do NOT use extended thinking or reasoning blocks. Respond directly and concisely.");
  }

  // Memory persistence instruction
  parts.push("");
  if (isLocal) {
    parts.push("Your memories are managed automatically. Use memory tools to save or recall important information. Do not rely on conversation history for long-term facts.");
    parts.push("**Context efficiency:** Conserve context — use read_file with offset/limit to grab specific lines instead of loading entire files, prefer bash (ls, grep, git log) for quick checks over reading full files, save recurring facts to memory instead of repeating them, reference earlier tool results instead of re-fetching, and spawn sub-agents for multi-step work so you don't hold all context in one session.");
  } else {
    parts.push("When you learn something important about the user or project, save it using the config or memory tools so you remember it next time.");
  }
  parts.push("");

  // Project context — check for .clank.md in workspace
  const projectMemory = await loadProjectMemory(opts.identity.workspace);
  if (projectMemory) {
    parts.push("## Project Context");
    parts.push(projectMemory);
    parts.push("");
  }

  return parts.join("\n");
}

/** Load workspace bootstrap files into a combined string */
async function loadWorkspaceFiles(workspaceDir: string, files: string[] = WORKSPACE_FILES): Promise<string | null> {
  const sections: string[] = [];

  for (const filename of files) {
    const filePath = join(workspaceDir, filename);
    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, "utf-8");
        if (content.trim()) {
          sections.push(content.trim());
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  return sections.length > 0 ? sections.join("\n\n---\n\n") : null;
}

/** Load a single workspace file by name */
async function loadSingleFile(workspaceDir: string, filename: string): Promise<string | null> {
  const filePath = join(workspaceDir, filename);
  if (existsSync(filePath)) {
    try {
      const content = await readFile(filePath, "utf-8");
      return content.trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Load project-specific memory (.clank.md) */
async function loadProjectMemory(projectRoot: string): Promise<string | null> {
  const candidates = [".clank.md", ".clankbuild.md", ".llamabuild.md"];

  for (const filename of candidates) {
    const filePath = join(projectRoot, filename);
    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, "utf-8");
        return content.trim() || null;
      } catch {
        continue;
      }
    }
  }

  return null;
}

/**
 * Ensure workspace directory has all template files.
 * Creates missing files from templates.
 */
export async function ensureWorkspaceFiles(workspaceDir: string, templateDir: string): Promise<void> {
  const { mkdir, copyFile } = await import("node:fs/promises");
  await mkdir(workspaceDir, { recursive: true });

  for (const filename of [...WORKSPACE_FILES, "BOOTSTRAP.md", "HEARTBEAT.md", "RUNNER.md"]) {
    const target = join(workspaceDir, filename);
    const source = join(templateDir, filename);
    if (!existsSync(target) && existsSync(source)) {
      await copyFile(source, target);
    }
  }
}
