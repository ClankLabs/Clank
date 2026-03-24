/**
 * Task registry — tracks background tasks spawned by agents.
 *
 * Supports multi-level sub-agent trees with depth tracking,
 * parent-child relationships, concurrent limits, and cascade
 * cancellation. In-memory only — tasks are ephemeral within
 * a gateway session lifetime.
 */

import { randomUUID } from "node:crypto";

export interface TaskEntry {
  id: string;
  label: string;
  agentId: string;
  model: string;
  status: "running" | "completed" | "failed" | "timeout";
  prompt: string;
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
  timeoutMs: number;
  /** Session key of the agent that spawned this task */
  spawnedBy: string;
  /** Whether results have been delivered to the spawning agent */
  delivered: boolean;
  /** Spawn depth: 0 = spawned by main, 1+ = nested sub-agent */
  spawnDepth: number;
  /** Session key of the parent task (for tree tracking) */
  parentSessionKey?: string;
  /** Task IDs of children spawned by this task's agent */
  children: string[];
}

export interface CreateTaskOpts {
  agentId: string;
  model: string;
  prompt: string;
  label: string;
  timeoutMs: number;
  spawnedBy: string;
  spawnDepth?: number;
  parentSessionKey?: string;
}

export class TaskRegistry {
  private tasks = new Map<string, TaskEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  /** Start the cleanup interval */
  start(): void {
    this.cleanupTimer = setInterval(() => this.cleanup(30 * 60_000), 10 * 60_000);
  }

  /** Stop the cleanup interval */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  /** Create a new running task */
  create(opts: CreateTaskOpts): TaskEntry {
    const entry: TaskEntry = {
      id: randomUUID(),
      label: opts.label,
      agentId: opts.agentId,
      model: opts.model,
      status: "running",
      prompt: opts.prompt,
      startedAt: Date.now(),
      timeoutMs: opts.timeoutMs,
      spawnedBy: opts.spawnedBy,
      delivered: false,
      spawnDepth: opts.spawnDepth ?? 0,
      parentSessionKey: opts.parentSessionKey,
      children: [],
    };
    this.tasks.set(entry.id, entry);

    // If this task was spawned by another task, add it as a child
    if (opts.parentSessionKey?.startsWith("task:")) {
      const parentTaskId = opts.parentSessionKey.slice(5);
      const parent = this.tasks.get(parentTaskId);
      if (parent) parent.children.push(entry.id);
    }

    return entry;
  }

  /** Update a task's fields */
  update(id: string, patch: Partial<Pick<TaskEntry, "status" | "result" | "error" | "completedAt">>): void {
    const task = this.tasks.get(id);
    if (task) Object.assign(task, patch);
  }

  /** Get a specific task */
  get(id: string): TaskEntry | undefined {
    return this.tasks.get(id);
  }

  /** Find a task by its session key (task:{id}) */
  getBySessionKey(sessionKey: string): TaskEntry | undefined {
    if (!sessionKey.startsWith("task:")) return undefined;
    return this.tasks.get(sessionKey.slice(5));
  }

  /** List all tasks, optionally filtered */
  list(filter?: { status?: TaskEntry["status"]; spawnedBy?: string }): TaskEntry[] {
    let results = Array.from(this.tasks.values());
    if (filter?.status) results = results.filter((t) => t.status === filter.status);
    if (filter?.spawnedBy) results = results.filter((t) => t.spawnedBy === filter.spawnedBy);
    return results.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Count running tasks spawned by a specific session */
  countActiveByParent(spawnedBy: string): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.spawnedBy === spawnedBy && task.status === "running") count++;
    }
    return count;
  }

  /** Recursively count all active descendants of a session */
  countActiveDescendants(sessionKey: string): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.spawnedBy === sessionKey && task.status === "running") {
        count++;
        // Recursively count this task's children
        count += this.countActiveDescendants(`task:${task.id}`);
      }
    }
    return count;
  }

  /**
   * Get completed tasks for a session that haven't been delivered yet.
   * Marks them as delivered so they aren't injected twice.
   */
  consumeCompleted(spawnedBy: string): TaskEntry[] {
    const ready: TaskEntry[] = [];
    for (const task of this.tasks.values()) {
      if (task.spawnedBy === spawnedBy && task.status !== "running" && !task.delivered) {
        task.delivered = true;
        ready.push(task);
      }
    }
    return ready;
  }

  /** Cancel a specific task */
  cancel(taskId: string): TaskEntry | undefined {
    const task = this.tasks.get(taskId);
    if (!task || task.status !== "running") return task;
    task.status = "timeout";
    task.completedAt = Date.now();
    task.error = "Cancelled by parent";
    return task;
  }

  /**
   * Cancel all tasks spawned by a session, and recursively cancel
   * their children. Returns total number of tasks cancelled.
   */
  cascadeCancel(sessionKey: string): number {
    let count = 0;
    for (const task of this.tasks.values()) {
      if (task.spawnedBy === sessionKey && task.status === "running") {
        task.status = "timeout";
        task.completedAt = Date.now();
        task.error = "Parent cancelled";
        count++;
        // Recursively cancel this task's children
        count += this.cascadeCancel(`task:${task.id}`);
      }
    }
    return count;
  }

  /** Remove completed tasks older than maxAgeMs */
  cleanup(maxAgeMs: number): void {
    const now = Date.now();
    for (const [id, task] of this.tasks) {
      if (task.status !== "running" && task.completedAt && now - task.completedAt > maxAgeMs) {
        this.tasks.delete(id);
      }
    }
  }

  /** Cancel all running tasks */
  cancelAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === "running") {
        task.status = "timeout";
        task.completedAt = Date.now();
        task.error = "Gateway shutting down";
      }
    }
  }
}
