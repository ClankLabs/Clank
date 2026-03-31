/**
 * Gateway CLI commands — start/stop/status/restart.
 *
 * The gateway runs as a background process. Telegram/Discord stay
 * alive in the background while you use CLI/TUI/Web on top.
 */

import { GatewayServer } from "../gateway/index.js";
import { loadConfig, ensureConfigDir, getConfigDir } from "../config/index.js";
import { DEFAULT_PORT } from "../gateway/protocol.js";
import { exec } from "node:child_process";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version for update check
let version = "1.11.1";
try {
  const { readFileSync } = await import("node:fs");
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
  version = pkg.version;
} catch { /* use default */ }

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

/** Check if gateway is already running */
export async function isGatewayRunning(port?: number): Promise<boolean> {
  const config = await loadConfig();
  const p = port || config.gateway.port || DEFAULT_PORT;
  try {
    const res = await fetch(`http://127.0.0.1:${p}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Get the PID file path */
function pidFilePath(): string {
  return join(getConfigDir(), "gateway.pid");
}

/**
 * Start the gateway in the foreground (blocking).
 * Used by `clank gateway start --foreground` and the background process.
 */
export async function gatewayStartForeground(opts: { port?: string }): Promise<void> {
  await ensureConfigDir();
  const config = await loadConfig();

  if (opts.port) {
    config.gateway.port = parseInt(opts.port, 10);
  }

  // Singleton check — only one gateway at a time
  if (await isGatewayRunning(config.gateway.port)) {
    console.log(green(`  Gateway already running on port ${config.gateway.port}`));
    return;
  }

  // Check for updates (interactive if foreground with a TTY, non-interactive otherwise)
  const interactive = process.stdin.isTTY === true;
  try {
    const { checkForUpdate } = await import("./update-check.js");
    const updated = await checkForUpdate(version, interactive);
    if (updated) {
      console.log(dim("  Restart Clank to use the updated version."));
      process.exit(0);
    }
  } catch {
    // Update check is best-effort — never block startup
  }

  // Write PID file
  await writeFile(pidFilePath(), String(process.pid), "utf-8");

  const server = new GatewayServer(config);

  const shutdown = async () => {
    console.log(dim("\nShutting down..."));
    try { await unlink(pidFilePath()); } catch {}
    await server.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    await server.start();
    console.log(green(`Gateway started on port ${config.gateway.port}`));
    console.log(dim("Press Ctrl+C to stop"));
  } catch (err) {
    try { await unlink(pidFilePath()); } catch {}
    console.error(red(`Failed to start gateway: ${err instanceof Error ? err.message : err}`));
    process.exit(1);
  }
}

/**
 * Start the gateway as a background process (non-blocking).
 * Returns once the gateway is confirmed running.
 */
export async function gatewayStartBackground(): Promise<boolean> {
  const config = await loadConfig();
  const port = config.gateway.port || DEFAULT_PORT;

  // Already running?
  if (await isGatewayRunning(port)) {
    return true;
  }

  console.log(dim("  Starting gateway in background..."));

  // Spawn a fully detached child process running `clank gateway start --foreground`
  const entryPoint = join(dirname(__filename), "index.js");

  // Ensure logs dir exists
  const { mkdir } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const { openSync } = await import("node:fs");
  await mkdir(join(getConfigDir(), "logs"), { recursive: true });

  // Use spawn (not fork) — fork keeps an IPC channel that ties the child
  // to the parent's console on Windows, so clearing PowerShell kills it.
  // spawn with detached + windowsHide fully detaches from the console.
  const logFile = join(getConfigDir(), "logs", "gateway.log");
  const logFd = openSync(logFile, "a");
  const child = spawn(process.execPath, [entryPoint, "gateway", "start", "--foreground"], {
    detached: true,
    stdio: ["ignore", logFd, logFd],
    windowsHide: true,
  });
  child.unref();

  // Wait for gateway to be ready (up to 10 seconds)
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isGatewayRunning(port)) {
      console.log(green(`  Gateway running on port ${port}`));
      return true;
    }
  }

  console.log(red("  Gateway failed to start"));
  return false;
}

/** Public entry: start gateway (background by default, foreground with --foreground) */
export async function gatewayStart(opts: { port?: string; foreground?: boolean }): Promise<void> {
  if (opts.foreground) {
    await gatewayStartForeground(opts);
  } else {
    const running = await gatewayStartBackground();
    if (!running) {
      process.exit(1);
    }
  }
}

export async function gatewayStop(): Promise<void> {
  // Try to kill via PID file
  const pidPath = pidFilePath();
  if (existsSync(pidPath)) {
    try {
      const pid = parseInt(await readFile(pidPath, "utf-8"), 10);
      process.kill(pid, "SIGTERM");
      await unlink(pidPath);
      console.log(green("Gateway stopped"));
      return;
    } catch {
      // PID might be stale
      try { await unlink(pidPath); } catch {}
    }
  }

  // Check if it's running anyway
  if (await isGatewayRunning()) {
    console.log(dim("Gateway is running but no PID file found."));
    console.log(dim("Kill it manually or restart the process."));
  } else {
    console.log(dim("Gateway is not running."));
  }
}

export async function gatewayStatus(): Promise<void> {
  const config = await loadConfig();
  const port = config.gateway.port || DEFAULT_PORT;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json() as Record<string, unknown>;
      console.log(green("Gateway is running"));
      console.log(dim(`  Port: ${port}`));
      console.log(dim(`  Clients: ${(data.clients as unknown[])?.length || 0}`));
      console.log(dim(`  Sessions: ${(data.sessions as unknown[])?.length || 0}`));

      // Show PID
      const pidPath = pidFilePath();
      if (existsSync(pidPath)) {
        const pid = await readFile(pidPath, "utf-8");
        console.log(dim(`  PID: ${pid.trim()}`));
      }
    } else {
      console.log(red("Gateway returned error"));
    }
  } catch {
    console.log(red("Gateway is not running"));
    console.log(dim(`  Expected at http://127.0.0.1:${port}`));
    console.log(dim("  Start with: clank gateway start"));
  }
}
