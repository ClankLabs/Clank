/**
 * Memory system — TF-IDF based long-term memory with categories and decay.
 *
 * Memories are stored as markdown files in categorized subdirectories:
 *   ~/.clank/memory/identity/   — who the agent is
 *   ~/.clank/memory/knowledge/  — facts and information
 *   ~/.clank/memory/lessons/    — things learned from experience
 *   ~/.clank/memory/context/    — project-specific context
 *
 * Each file has metadata (_meta.json) tracking access patterns for
 * decay scoring — memories that haven't been accessed fade over time.
 */

import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface MemoryEntry {
  id: string;
  category: "identity" | "knowledge" | "lessons" | "context";
  title: string;
  content: string;
  filePath: string;
}

export interface MemoryMeta {
  id: string;
  lastAccessed: number;
  accessCount: number;
  createdAt: number;
  dormant: boolean;
}

/** Common English stopwords to filter from TF-IDF */
const STOPWORDS = new Set([
  "the", "be", "to", "of", "and", "a", "in", "that", "have", "i",
  "it", "for", "not", "on", "with", "he", "as", "you", "do", "at",
  "this", "but", "his", "by", "from", "they", "we", "say", "her",
  "she", "or", "an", "will", "my", "one", "all", "would", "there",
  "their", "what", "so", "up", "out", "if", "about", "who", "get",
  "which", "go", "me", "when", "make", "can", "like", "time", "no",
  "just", "him", "know", "take", "people", "into", "year", "your",
  "good", "some", "could", "them", "see", "other", "than", "then",
  "now", "look", "only", "come", "its", "over", "think", "also",
  "back", "after", "use", "two", "how", "our", "work", "first",
  "well", "way", "even", "new", "want", "because", "any", "these",
  "give", "day", "most", "us", "is", "are", "was", "were", "been",
  "has", "had", "did", "does", "am",
]);

export class MemoryManager {
  private memoryDir: string;
  private metaPath: string;
  private meta: Map<string, MemoryMeta> = new Map();

  constructor(memoryDir: string) {
    this.memoryDir = memoryDir;
    this.metaPath = join(memoryDir, "_meta.json");
  }

  /** Initialize — create dirs and load metadata */
  async init(): Promise<void> {
    for (const cat of ["identity", "knowledge", "lessons", "context"]) {
      await mkdir(join(this.memoryDir, cat), { recursive: true });
    }
    await this.loadMeta();
  }

  /** Find memories relevant to a query using TF-IDF cosine similarity */
  async findRelevant(query: string, topK = 3): Promise<MemoryEntry[]> {
    const entries = await this.loadAll();
    if (entries.length === 0) return [];

    const queryTerms = tokenize(query);
    if (queryTerms.length === 0) return entries.slice(0, topK);

    // Build document frequency map
    const df = new Map<string, number>();
    const docs = entries.map((e) => {
      const terms = tokenize(e.content);
      const unique = new Set(terms);
      for (const t of unique) df.set(t, (df.get(t) || 0) + 1);
      return { entry: e, terms };
    });

    const N = docs.length;

    // Score each document
    const scored = docs.map(({ entry, terms }) => {
      const score = cosineSimilarity(queryTerms, terms, df, N);
      // Apply decay: reduce score for old, unused memories
      const meta = this.meta.get(entry.id);
      const decayFactor = meta ? this.decayScore(meta) : 0.5;
      return { entry, score: score * decayFactor };
    });

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Update access metadata for returned results
    const results = scored.slice(0, topK).filter((s) => s.score > 0.01).map((s) => s.entry);
    for (const entry of results) {
      const meta = this.meta.get(entry.id);
      if (meta) {
        meta.lastAccessed = Date.now();
        meta.accessCount++;
      }
    }
    await this.saveMeta();

    return results;
  }

  /**
   * Build the memory block for injection into the system prompt.
   * Combines global memory, project memory, and relevant topics.
   */
  async buildMemoryBlock(userMessage: string, projectRoot?: string, budgetChars = 4000): Promise<string> {
    const parts: string[] = [];
    let used = 0;

    // 1. Project memory (.clank.md)
    if (projectRoot) {
      for (const name of [".clank.md", ".clankbuild.md", ".llamabuild.md"]) {
        const path = join(projectRoot, name);
        if (existsSync(path)) {
          try {
            const content = await readFile(path, "utf-8");
            if (content.trim() && used + content.length < budgetChars) {
              parts.push("## Project Memory\n" + content.trim());
              used += content.length;
            }
          } catch { /* skip */ }
          break;
        }
      }
    }

    // 2. Global memory (MEMORY.md)
    const globalPath = join(this.memoryDir, "..", "workspace", "MEMORY.md");
    if (existsSync(globalPath)) {
      try {
        const content = await readFile(globalPath, "utf-8");
        if (content.trim() && used + content.length < budgetChars) {
          parts.push("## Global Memory\n" + content.trim());
          used += content.length;
        }
      } catch { /* skip */ }
    }

    // 3. Relevant memories (TF-IDF matched)
    const relevant = await this.findRelevant(userMessage, 3);
    for (const entry of relevant) {
      if (used + entry.content.length > budgetChars) break;
      parts.push(`## ${entry.title}\n${entry.content}`);
      used += entry.content.length;
    }

    return parts.length > 0 ? parts.join("\n\n") : "";
  }

  /** Add a new memory */
  async add(category: MemoryEntry["category"], title: string, content: string): Promise<MemoryEntry> {
    const filename = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 50)}.md`;
    const id = filename;
    const filePath = join(this.memoryDir, category, filename);

    await writeFile(filePath, `# ${title}\n\n${content}`, "utf-8");

    this.meta.set(id, {
      id,
      lastAccessed: Date.now(),
      accessCount: 0,
      createdAt: Date.now(),
      dormant: false,
    });
    await this.saveMeta();

    return { id, category, title, content, filePath };
  }

  /** Decay scores — flag dormant memories (30+ days unused) */
  async decayScores(): Promise<number> {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    let flagged = 0;

    for (const [, meta] of this.meta) {
      if (now - meta.lastAccessed > thirtyDays && !meta.dormant) {
        meta.dormant = true;
        flagged++;
      }
    }

    if (flagged > 0) await this.saveMeta();
    return flagged;
  }

  /** Prune dormant memories older than 90 days */
  async prune(): Promise<number> {
    const now = Date.now();
    const ninetyDays = 90 * 24 * 60 * 60 * 1000;
    let pruned = 0;

    for (const [id, meta] of this.meta) {
      if (meta.dormant && now - meta.lastAccessed > ninetyDays) {
        this.meta.delete(id);
        pruned++;
      }
    }

    if (pruned > 0) await this.saveMeta();
    return pruned;
  }

  /** Load all memory entries from disk */
  private async loadAll(): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];

    for (const category of ["identity", "knowledge", "lessons", "context"] as const) {
      const dir = join(this.memoryDir, category);
      if (!existsSync(dir)) continue;

      try {
        const files = await readdir(dir);
        for (const file of files) {
          if (!file.endsWith(".md")) continue;
          const filePath = join(dir, file);
          try {
            const content = await readFile(filePath, "utf-8");
            const title = content.split("\n")[0]?.replace(/^#\s*/, "") || file;
            entries.push({
              id: file,
              category,
              title,
              content,
              filePath,
            });
          } catch { /* skip */ }
        }
      } catch { /* skip */ }
    }

    return entries;
  }

  /** Calculate decay factor for a memory (1.0 = fresh, 0.25 = old) */
  private decayScore(meta: MemoryMeta): number {
    const daysSinceAccess = (Date.now() - meta.lastAccessed) / (24 * 60 * 60 * 1000);
    const recency = daysSinceAccess < 1 ? 1.0
      : daysSinceAccess < 30 ? 0.5
      : 0.25;
    const frequencyBoost = Math.min(1.5, 1 + meta.accessCount * 0.1);
    return recency * frequencyBoost;
  }

  private async loadMeta(): Promise<void> {
    if (!existsSync(this.metaPath)) return;
    try {
      const raw = await readFile(this.metaPath, "utf-8");
      const entries = JSON.parse(raw) as MemoryMeta[];
      for (const e of entries) this.meta.set(e.id, e);
    } catch { /* start fresh */ }
  }

  private async saveMeta(): Promise<void> {
    const entries = Array.from(this.meta.values());
    await writeFile(this.metaPath, JSON.stringify(entries, null, 2), "utf-8");
  }
}

/** Tokenize text for TF-IDF */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Compute TF-IDF cosine similarity between query and document */
function cosineSimilarity(
  queryTerms: string[],
  docTerms: string[],
  df: Map<string, number>,
  N: number,
): number {
  // Build TF maps
  const queryTf = new Map<string, number>();
  for (const t of queryTerms) queryTf.set(t, (queryTf.get(t) || 0) + 1);

  const docTf = new Map<string, number>();
  for (const t of docTerms) docTf.set(t, (docTf.get(t) || 0) + 1);

  // Compute TF-IDF vectors and dot product
  let dotProduct = 0;
  let queryMag = 0;
  let docMag = 0;

  const allTerms = new Set([...queryTf.keys(), ...docTf.keys()]);
  for (const term of allTerms) {
    const idf = Math.log(N / (df.get(term) || 1));
    const qVal = (queryTf.get(term) || 0) * idf;
    const dVal = (docTf.get(term) || 0) * idf;
    dotProduct += qVal * dVal;
    queryMag += qVal * qVal;
    docMag += dVal * dVal;
  }

  const magnitude = Math.sqrt(queryMag) * Math.sqrt(docMag);
  return magnitude > 0 ? dotProduct / magnitude : 0;
}
