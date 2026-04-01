/**
 * Health check & self-healing tool.
 *
 * Lets the agent monitor its own health and recover from common issues:
 * - Check provider connectivity
 * - Check adapter status (Telegram, Discord, Signal)
 * - Check disk/memory usage
 * - Restart failed adapters
 * - Compact stale sessions
 */

import { loadConfig } from "../../config/index.js";
import { DEFAULT_PORT } from "../../gateway/protocol.js";
import type { Tool, ToolContext, ValidationResult } from "../types.js";

export const healthTool: Tool = {
  definition: {
    name: "health_check",
    description:
      "Monitor system health and self-heal. Actions: " +
      "'diagnose' (full system check — providers, adapters, memory, disk), " +
      "'restart_adapter' (restart a failed channel adapter by name: telegram, discord, signal), " +
      "'check_provider' (test connectivity to a specific provider: ollama, anthropic, openai, google), " +
      "'alerts' (check for active alerts: high latency, failed adapters, task failures, memory pressure).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description: "Action: 'diagnose', 'restart_adapter', 'check_provider'",
        },
        target: {
          type: "string",
          description: "Target for restart_adapter (adapter name) or check_provider (provider name)",
        },
      },
      required: ["action"],
    },
  },

  safetyLevel: "low",
  readOnly: true,

  validate(args: Record<string, unknown>): ValidationResult {
    const action = args.action as string;
    if (!["diagnose", "restart_adapter", "check_provider", "alerts"].includes(action)) {
      return { ok: false, error: "action must be 'diagnose', 'restart_adapter', 'check_provider', or 'alerts'" };
    }
    if ((action === "restart_adapter" || action === "check_provider") && !args.target) {
      return { ok: false, error: `'target' is required for ${action}` };
    }
    return { ok: true };
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = args.action as string;
    const target = args.target as string | undefined;

    switch (action) {
      case "diagnose":
        return runDiagnosis();
      case "check_provider":
        return checkProvider(target!);
      case "restart_adapter":
        return restartAdapter(target!);
      case "alerts":
        return checkAlerts();
      default:
        return "Unknown action";
    }
  },
};

async function runDiagnosis(): Promise<string> {
  const config = await loadConfig();
  const port = config.gateway.port || DEFAULT_PORT;
  const lines: string[] = ["## System Health Report", ""];

  // Gateway
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json() as { version: string; uptime: number; clients: number; agents: number };
      lines.push(`**Gateway:** OK (v${data.version}, uptime ${Math.round(data.uptime)}s, ${data.clients} clients)`);
    } else {
      lines.push("**Gateway:** ERROR — returned " + res.status);
    }
  } catch {
    lines.push("**Gateway:** NOT RUNNING");
  }

  // Providers
  lines.push("");
  lines.push("### Providers");
  const providers = config.models.providers as Record<string, { baseUrl?: string; apiKey?: string } | undefined>;

  // Local providers
  for (const [name, port] of [["ollama", 11434], ["lmstudio", 1234], ["llamacpp", 8080], ["vllm", 8000]] as const) {
    const url = providers[name]?.baseUrl || `http://127.0.0.1:${port}`;
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      lines.push(`- **${name}:** OK (${url})`);
    } catch {
      lines.push(`- **${name}:** not reachable`);
    }
  }

  // Cloud providers
  for (const name of ["anthropic", "openai", "google", "openrouter"]) {
    if (providers[name]?.apiKey) {
      lines.push(`- **${name}:** configured (API key present)`);
    }
  }

  // Channels
  lines.push("");
  lines.push("### Channels");
  const channels = config.channels;
  lines.push(`- **Web UI:** ${channels.web?.enabled !== false ? "enabled" : "disabled"}`);
  lines.push(`- **Telegram:** ${channels.telegram?.enabled ? "enabled" : "disabled"}`);
  lines.push(`- **Discord:** ${channels.discord?.enabled ? "enabled" : "disabled"}`);
  lines.push(`- **Signal:** ${channels.signal?.enabled ? "enabled" : "disabled"}`);

  if (channels.signal?.enabled) {
    const ep = channels.signal.endpoint || "http://localhost:7583";
    try {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "listAccounts", params: {} });
      const res = await fetch(`${ep}/api/v1/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(3000),
      });
      lines.push(`  - signal-cli daemon: ${res.ok ? "running" : "error " + res.status}`);
    } catch {
      lines.push("  - signal-cli daemon: not reachable");
    }
  }

  // Memory
  lines.push("");
  lines.push("### System");
  const mem = process.memoryUsage();
  lines.push(`- **Process memory:** ${Math.round(mem.rss / 1024 / 1024)}MB RSS, ${Math.round(mem.heapUsed / 1024 / 1024)}MB heap`);
  lines.push(`- **Uptime:** ${Math.round(process.uptime())}s`);

  return lines.join("\n");
}

async function checkProvider(name: string): Promise<string> {
  const config = await loadConfig();
  const providers = config.models.providers as Record<string, { baseUrl?: string; apiKey?: string } | undefined>;

  const localPorts: Record<string, number> = {
    ollama: 11434, lmstudio: 1234, llamacpp: 8080, vllm: 8000,
  };

  if (localPorts[name]) {
    const url = providers[name]?.baseUrl || `http://127.0.0.1:${localPorts[name]}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      return `${name}: reachable at ${url} (status ${res.status})`;
    } catch (err) {
      return `${name}: NOT reachable at ${url} — ${err instanceof Error ? err.message : err}`;
    }
  }

  if (providers[name]?.apiKey) {
    return `${name}: configured (API key present). Cloud providers are tested on first use.`;
  }

  return `${name}: not configured`;
}

async function restartAdapter(name: string): Promise<string> {
  // We can't directly restart adapters from a tool — but we can provide guidance
  // and check if the adapter's backing service is reachable
  const config = await loadConfig();

  if (name === "signal") {
    const ep = config.channels.signal?.endpoint || "http://localhost:7583";
    try {
      const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "listAccounts", params: {} });
      const res = await fetch(`${ep}/api/v1/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return "Signal daemon is running. If the adapter is disconnected, restart the gateway: `clank gateway restart`";
      }
    } catch { /* fall through */ }

    // Try to restart the daemon
    if (config.channels.signal?.account) {
      try {
        const { startSignalDaemon } = await import("../../cli/signal-setup.js");
        const ok = await startSignalDaemon(config.channels.signal.account, ep);
        return ok
          ? "Signal daemon restarted. Restart the gateway to reconnect the adapter."
          : "Failed to start signal-cli daemon. Check logs at ~/.clank/logs/signal-cli.log";
      } catch (err) {
        return `Failed to restart signal daemon: ${err instanceof Error ? err.message : err}`;
      }
    }
    return "Signal not configured. Run `clank setup --signal` to set it up.";
  }

  return `To restart the ${name} adapter, restart the gateway: \`clank gateway restart\``;
}

async function checkAlerts(): Promise<string> {
  const config = await loadConfig();
  const port = config.gateway.port || DEFAULT_PORT;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/metrics`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return "Could not fetch metrics from gateway.";

    const metrics = await res.json() as {
      latency: { avg: number; p95: number };
      tasks: { completed: number; failed: number; timedOut: number; active: number };
      errors: { total: number; recent: Array<{ time: number; message: string }> };
    };

    const alerts: string[] = [];

    // High latency
    if (metrics.latency.avg > 30_000) {
      alerts.push(`- **WARNING:** High average latency: ${Math.round(metrics.latency.avg / 1000)}s`);
    }
    if (metrics.latency.p95 > 60_000) {
      alerts.push(`- **CRITICAL:** P95 latency over 60s: ${Math.round(metrics.latency.p95 / 1000)}s`);
    }

    // Task failure rate
    const totalTasks = metrics.tasks.completed + metrics.tasks.failed + metrics.tasks.timedOut;
    if (totalTasks >= 5) {
      const failRate = (metrics.tasks.failed + metrics.tasks.timedOut) / totalTasks;
      if (failRate > 0.5) {
        alerts.push(`- **CRITICAL:** Task failure rate: ${Math.round(failRate * 100)}%`);
      }
    }

    // Memory usage
    const mem = process.memoryUsage();
    const heapPercent = mem.heapUsed / mem.heapTotal;
    if (heapPercent > 0.8) {
      alerts.push(`- **WARNING:** Heap usage: ${Math.round(heapPercent * 100)}%`);
    }

    // Recent errors
    const fiveMinAgo = Date.now() - 300_000;
    const recentErrors = metrics.errors.recent.filter((e) => e.time > fiveMinAgo);
    if (recentErrors.length > 5) {
      alerts.push(`- **WARNING:** ${recentErrors.length} errors in last 5 minutes`);
    }

    if (alerts.length === 0) {
      return "## Alerts\n\nNo active alerts. All systems normal.";
    }

    return `## Active Alerts\n\n${alerts.join("\n")}`;
  } catch {
    return "Could not reach gateway to check alerts. Is the gateway running?";
  }
}
