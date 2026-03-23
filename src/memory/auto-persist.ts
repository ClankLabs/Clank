/**
 * Automatic memory persistence.
 *
 * After each conversation turn, extracts important information
 * and saves it to the workspace MEMORY.md. This happens in the
 * background — no user setup needed.
 *
 * Extracts: user preferences, project facts, decisions made,
 * corrections ("no, do it this way"), explicit "remember this" requests.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Patterns that indicate something worth remembering */
const PERSIST_TRIGGERS = [
  /remember\s+(that|this|:)/i,
  /don'?t\s+forget/i,
  /always\s+(use|do|make|keep)/i,
  /never\s+(use|do|make)/i,
  /my\s+(name|email|timezone|preference)/i,
  /i\s+(prefer|like|want|need|use)\s/i,
  /from now on/i,
  /going forward/i,
  /important:\s/i,
  /note:\s/i,
];

/**
 * Check if a user message contains something worth persisting.
 */
export function shouldPersist(userMessage: string): boolean {
  return PERSIST_TRIGGERS.some((pattern) => pattern.test(userMessage));
}

/**
 * Extract a memory entry from a user message.
 */
export function extractMemory(userMessage: string): string | null {
  // If the message explicitly says "remember X"
  const rememberMatch = userMessage.match(/remember\s+(?:that\s+)?(.+)/i);
  if (rememberMatch) return rememberMatch[1].trim();

  // For preference patterns, keep the full statement
  for (const pattern of PERSIST_TRIGGERS) {
    if (pattern.test(userMessage)) {
      // Keep it short — first sentence or 200 chars
      const firstSentence = userMessage.split(/[.!?\n]/)[0]?.trim();
      return firstSentence && firstSentence.length < 200 ? firstSentence : userMessage.slice(0, 200);
    }
  }

  return null;
}

/**
 * Append a memory entry to the workspace MEMORY.md.
 * Creates the file if it doesn't exist.
 */
export async function appendToMemory(workspaceDir: string, entry: string): Promise<void> {
  const memoryPath = join(workspaceDir, "MEMORY.md");
  const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const newEntry = `\n- [${timestamp}] ${entry}`;

  if (existsSync(memoryPath)) {
    const existing = await readFile(memoryPath, "utf-8");
    // Don't add duplicates
    if (existing.includes(entry)) return;
    // Don't let the file grow unbounded
    const lines = existing.split("\n");
    if (lines.length > 200) return; // Cap at 200 entries
    await writeFile(memoryPath, existing.trimEnd() + newEntry + "\n", "utf-8");
  } else {
    await writeFile(
      memoryPath,
      `# MEMORY.md — Persistent Memory\n\nThings learned across sessions:\n${newEntry}\n`,
      "utf-8",
    );
  }
}
