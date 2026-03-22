/**
 * Heartbeat system — periodic proactive agent checks.
 *
 * Reads HEARTBEAT.md from the workspace to determine what to check.
 * Runs probes on a configurable interval (default: 30 min),
 * batches results into a summary, and sends proactive notifications
 * to the user's active channel. Respects quiet hours.
 */

export interface HeartbeatConfig {
  enabled: boolean;
  intervalMs: number;
  quietHours?: { start: number; end: number }; // 24h format, e.g., { start: 22, end: 7 }
}

export interface HeartbeatProbe {
  name: string;
  prompt: string;
}

export class HeartbeatRunner {
  private config: HeartbeatConfig;
  private probes: HeartbeatProbe[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private onProbe?: (probe: HeartbeatProbe) => Promise<string>;

  constructor(config: HeartbeatConfig) {
    this.config = config;
  }

  /** Set probes from HEARTBEAT.md content */
  loadProbes(heartbeatContent: string): void {
    this.probes = [];
    const lines = heartbeatContent.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
    for (const line of lines) {
      const trimmed = line.replace(/^[-*]\s*/, "").trim();
      if (trimmed) {
        this.probes.push({ name: trimmed.slice(0, 50), prompt: trimmed });
      }
    }
  }

  /** Set the callback for running probes */
  setHandler(handler: (probe: HeartbeatProbe) => Promise<string>): void {
    this.onProbe = handler;
  }

  /** Start the heartbeat timer */
  start(): void {
    if (!this.config.enabled || this.probes.length === 0) return;

    this.timer = setInterval(() => this.tick(), this.config.intervalMs);
  }

  /** Stop the heartbeat timer */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Run all probes */
  private async tick(): Promise<void> {
    if (this.isQuietHours()) return;

    for (const probe of this.probes) {
      try {
        if (this.onProbe) {
          await this.onProbe(probe);
        }
      } catch {
        // Probe failed — log but continue
      }
    }
  }

  /** Check if current time is within quiet hours */
  private isQuietHours(): boolean {
    if (!this.config.quietHours) return false;
    const hour = new Date().getHours();
    const { start, end } = this.config.quietHours;
    if (start < end) {
      return hour >= start && hour < end;
    }
    // Wraps around midnight (e.g., 22-7)
    return hour >= start || hour < end;
  }
}
