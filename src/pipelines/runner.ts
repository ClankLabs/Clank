/**
 * Pipeline runner — chains agent execution with handoffs.
 *
 * Pipelines let you define multi-agent workflows:
 *   1. Agent A reads the PR
 *   2. Agent B researches best practices
 *   3. Agent A writes review comments
 *
 * Each step's output becomes the next step's input context.
 * Supports abort, resume, timeout per step, and state persistence.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface PipelineStep {
  agent: string;
  action: string;
  timeout?: number; // ms
}

export interface PipelineDefinition {
  id: string;
  name: string;
  steps: PipelineStep[];
}

export type PipelineStatus = "pending" | "running" | "completed" | "failed" | "aborted";

export interface PipelineState {
  id: string;
  definitionId: string;
  status: PipelineStatus;
  currentStep: number;
  stepResults: Array<{
    agent: string;
    action: string;
    output: string;
    status: "completed" | "failed" | "skipped";
    durationMs: number;
  }>;
  startedAt: number;
  completedAt?: number;
  error?: string;
}

export class PipelineRunner {
  private stateDir: string;
  private definitions = new Map<string, PipelineDefinition>();
  /** Callback to run an agent step — provided by the gateway */
  private runAgentStep?: (agentId: string, prompt: string, timeoutMs: number) => Promise<string>;

  constructor(stateDir: string) {
    this.stateDir = stateDir;
  }

  async init(): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
  }

  /** Register a pipeline definition */
  registerDefinition(def: PipelineDefinition): void {
    this.definitions.set(def.id, def);
  }

  /** Set the agent step runner callback */
  setRunner(runner: (agentId: string, prompt: string, timeoutMs: number) => Promise<string>): void {
    this.runAgentStep = runner;
  }

  /** Start a pipeline execution */
  async run(definitionId: string): Promise<PipelineState> {
    const def = this.definitions.get(definitionId);
    if (!def) throw new Error(`Pipeline not found: ${definitionId}`);
    if (!this.runAgentStep) throw new Error("No agent step runner configured");

    const state: PipelineState = {
      id: randomUUID(),
      definitionId,
      status: "running",
      currentStep: 0,
      stepResults: [],
      startedAt: Date.now(),
    };

    let previousOutput = "";

    for (let i = 0; i < def.steps.length; i++) {
      state.currentStep = i;
      await this.saveState(state);

      const step = def.steps[i];
      const timeout = step.timeout || 300_000; // 5 min default

      // Build prompt with previous output as context
      let prompt = step.action;
      if (previousOutput) {
        prompt = `Previous step output:\n${previousOutput}\n\n---\n\nYour task: ${step.action}`;
      }

      const stepStart = Date.now();
      try {
        const output = await this.runAgentStep(step.agent, prompt, timeout);
        previousOutput = output;
        state.stepResults.push({
          agent: step.agent,
          action: step.action,
          output,
          status: "completed",
          durationMs: Date.now() - stepStart,
        });
      } catch (err) {
        state.stepResults.push({
          agent: step.agent,
          action: step.action,
          output: "",
          status: "failed",
          durationMs: Date.now() - stepStart,
        });
        state.status = "failed";
        state.error = err instanceof Error ? err.message : String(err);
        state.completedAt = Date.now();
        await this.saveState(state);
        return state;
      }
    }

    state.status = "completed";
    state.completedAt = Date.now();
    await this.saveState(state);
    return state;
  }

  /** Abort a running pipeline */
  async abort(pipelineId: string): Promise<void> {
    const state = await this.loadState(pipelineId);
    if (state && state.status === "running") {
      state.status = "aborted";
      state.completedAt = Date.now();
      await this.saveState(state);
    }
  }

  /** Load pipeline state from disk */
  async loadState(pipelineId: string): Promise<PipelineState | null> {
    const path = join(this.stateDir, `${pipelineId}.json`);
    if (!existsSync(path)) return null;
    try {
      const raw = await readFile(path, "utf-8");
      return JSON.parse(raw) as PipelineState;
    } catch {
      return null;
    }
  }

  /** Save pipeline state to disk */
  private async saveState(state: PipelineState): Promise<void> {
    const path = join(this.stateDir, `${state.id}.json`);
    await writeFile(path, JSON.stringify(state, null, 2), "utf-8");
  }

  /** List all pipeline definitions */
  listDefinitions(): PipelineDefinition[] {
    return Array.from(this.definitions.values());
  }
}
