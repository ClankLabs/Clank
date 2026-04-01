/**
 * Session store — manages conversation sessions.
 *
 * Sessions are persisted as JSON files on disk. Each session has a
 * normalized key that identifies it across channels:
 *   - cli:main         (CLI default session)
 *   - web:main         (Web UI default session)
 *   - dm:telegram:123  (Telegram DM with user 123)
 *   - group:discord:456 (Discord server 456)
 *
 * This cross-channel key system is what enables session continuity —
 * start in CLI, continue in the browser, check from Telegram.
 */

import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Message } from "../providers/types.js";

export interface SessionEntry {
  id: string;
  normalizedKey: string;
  label?: string;
  agentId?: string;
  model?: string;
  lastChannel?: string;
  updatedAt: number;
  createdAt: number;
}

export interface SessionData {
  entry: SessionEntry;
  messages: Message[];
}

export class SessionStore {
  private storeDir: string;
  private indexPath: string;
  private index: Map<string, SessionEntry> = new Map();

  constructor(storeDir: string) {
    this.storeDir = storeDir;
    this.indexPath = join(storeDir, "sessions.json");
  }

  /** Initialize the store — load index from disk */
  async init(): Promise<void> {
    await mkdir(this.storeDir, { recursive: true });

    if (existsSync(this.indexPath)) {
      try {
        const raw = await readFile(this.indexPath, "utf-8");
        const entries = JSON.parse(raw) as SessionEntry[];
        for (const entry of entries) {
          this.index.set(entry.normalizedKey, entry);
        }
      } catch (err) {
        // Corrupt index — start fresh, but warn the user
        console.error(`Warning: Session index was corrupt and has been reset (${this.indexPath})`);
        this.index.clear();
      }
    }
  }

  /** Save the index to disk */
  private async saveIndex(): Promise<void> {
    const entries = Array.from(this.index.values());
    await writeFile(this.indexPath, JSON.stringify(entries, null, 2), "utf-8");
  }

  /** Get or create a session for a normalized key */
  async resolve(normalizedKey: string, opts?: { agentId?: string; channel?: string }): Promise<SessionEntry> {
    let entry = this.index.get(normalizedKey);
    if (entry) {
      // Update last access
      entry.updatedAt = Date.now();
      if (opts?.channel) entry.lastChannel = opts.channel;
      if (opts?.agentId) entry.agentId = opts.agentId;
      await this.saveIndex();
      return entry;
    }

    // Create new session
    entry = {
      id: randomUUID(),
      normalizedKey,
      agentId: opts?.agentId,
      lastChannel: opts?.channel,
      updatedAt: Date.now(),
      createdAt: Date.now(),
    };
    this.index.set(normalizedKey, entry);
    await this.saveIndex();
    return entry;
  }

  /** Load conversation messages for a session */
  async loadMessages(sessionId: string): Promise<Message[]> {
    const path = join(this.storeDir, `${sessionId}.json`);
    if (!existsSync(path)) return [];

    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as Message[];
    } catch {
      console.error(`Warning: Session file was corrupt, starting fresh (${path})`);
      return [];
    }
  }

  /** Save conversation messages for a session */
  async saveMessages(sessionId: string, messages: Message[]): Promise<void> {
    const path = join(this.storeDir, `${sessionId}.json`);
    await writeFile(path, JSON.stringify(messages, null, 2), "utf-8");
  }

  /** List all sessions, sorted by last used */
  list(): SessionEntry[] {
    return Array.from(this.index.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Delete a session */
  async delete(normalizedKey: string): Promise<boolean> {
    const entry = this.index.get(normalizedKey);
    if (!entry) return false;

    this.index.delete(normalizedKey);
    await this.saveIndex();

    // Delete conversation file
    const path = join(this.storeDir, `${entry.id}.json`);
    try {
      await unlink(path);
    } catch {
      // File may not exist
    }

    return true;
  }

  /** Reset a session (clear messages but keep the entry) */
  async reset(normalizedKey: string): Promise<SessionEntry | null> {
    const entry = this.index.get(normalizedKey);
    if (!entry) return null;

    // Clear messages
    const path = join(this.storeDir, `${entry.id}.json`);
    try {
      await unlink(path);
    } catch {
      // OK if file doesn't exist
    }

    entry.updatedAt = Date.now();
    await this.saveIndex();
    return entry;
  }

  /** Prune old sessions to stay under the max count */
  async prune(maxSessions: number): Promise<number> {
    const entries = this.list();
    let pruned = 0;

    while (entries.length - pruned > maxSessions) {
      const oldest = entries[entries.length - 1 - pruned];
      if (oldest) {
        await this.delete(oldest.normalizedKey);
        pruned++;
      } else {
        break;
      }
    }

    return pruned;
  }

  /** Update a session's label (auto-title from first message) */
  async setLabel(normalizedKey: string, label: string): Promise<void> {
    const entry = this.index.get(normalizedKey);
    if (entry) {
      entry.label = label;
      await this.saveIndex();
    }
  }
}
