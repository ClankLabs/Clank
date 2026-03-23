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

/**
 * Build the complete system prompt for an agent.
 */
export async function buildSystemPrompt(opts: {
  identity: AgentIdentity;
  workspaceDir: string;
  channel?: string;
  compact?: boolean;
  thinking?: "on" | "off" | "auto";
}): Promise<string> {
  const parts: string[] = [];
  const compact = opts.compact ?? false;

  if (!compact) {
    // Full mode: load workspace files (SOUL.md, USER.md, etc.)
    const workspaceContent = await loadWorkspaceFiles(opts.workspaceDir);
    if (workspaceContent) {
      parts.push(workspaceContent);
      parts.push("---");
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
      "You have tools: read_file, write_file, edit_file, list_directory, bash, search_files, glob_files, git, web_search, web_fetch, and self-config tools.",
      "ALWAYS use your tools. NEVER say you cannot access files, run commands, or perform actions. You CAN — use your tools.",
      "NEVER apologize and refuse. If asked to do something, DO IT with your tools or explain what tool you need.",
    ].join(" "));
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
  }

  // Thinking control
  if (opts.thinking === "off") {
    parts.push("");
    parts.push("Do NOT use extended thinking or reasoning blocks. Respond directly and concisely.");
  }

  // Memory persistence instruction
  parts.push("");
  parts.push("When you learn something important about the user or project, save it using the config or memory tools so you remember it next time.");
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
async function loadWorkspaceFiles(workspaceDir: string): Promise<string | null> {
  const sections: string[] = [];

  for (const filename of WORKSPACE_FILES) {
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

  for (const filename of [...WORKSPACE_FILES, "BOOTSTRAP.md", "HEARTBEAT.md"]) {
    const target = join(workspaceDir, filename);
    const source = join(templateDir, filename);
    if (!existsSync(target) && existsSync(source)) {
      await copyFile(source, target);
    }
  }
}
