/**
 * Signal setup wizard — `clank setup --signal`
 *
 * Guides the user through installing signal-cli, registering a phone number,
 * and configuring Clank to use it. Also manages the signal-cli daemon lifecycle.
 */

import { createInterface } from "node:readline";
import { platform } from "node:os";
import { execSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, readFile, unlink, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig, saveConfig, getConfigDir } from "../config/index.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

/** Check if a command exists on PATH */
function commandExists(cmd: string): boolean {
  try {
    const check = platform() === "win32" ? `where ${cmd}` : `which ${cmd}`;
    execSync(check, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Check if Java is installed (required by signal-cli) */
function javaInstalled(): boolean {
  try {
    execSync("java -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Get the signal-cli daemon PID file path */
function signalPidPath(): string {
  return join(getConfigDir(), "signal-cli.pid");
}

/** Check if the signal-cli daemon is running */
export async function isSignalDaemonRunning(endpoint: string = "http://localhost:7583"): Promise<boolean> {
  try {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "listAccounts", params: {} });
    const res = await fetch(`${endpoint}/api/v1/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start the signal-cli daemon as a background process.
 * Only called when Signal is enabled in config.
 */
export async function startSignalDaemon(account: string, endpoint: string = "http://localhost:7583"): Promise<boolean> {
  // Already running?
  if (await isSignalDaemonRunning(endpoint)) {
    return true;
  }

  // Check signal-cli exists
  if (!commandExists("signal-cli")) {
    console.log("  Signal: signal-cli not found — skipping daemon start");
    return false;
  }

  const port = new URL(endpoint).port || "7583";
  const host = new URL(endpoint).hostname || "localhost";

  console.log(dim(`  Signal: starting signal-cli daemon on ${host}:${port}...`));

  try {
    await mkdir(join(getConfigDir(), "logs"), { recursive: true });
    const { openSync } = await import("node:fs");
    const logFile = join(getConfigDir(), "logs", "signal-cli.log");
    const logFd = openSync(logFile, "a");

    const child = spawn("signal-cli", ["-a", account, "daemon", "--http", `${host}:${port}`], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      windowsHide: true,
    });
    child.unref();

    // Write PID file
    if (child.pid) {
      await writeFile(signalPidPath(), String(child.pid), "utf-8");
    }

    // Wait up to 10 seconds for daemon to be ready
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await isSignalDaemonRunning(endpoint)) {
        console.log(green(`  Signal: daemon running on ${host}:${port}`));
        return true;
      }
    }

    console.log(yellow("  Signal: daemon started but not responding yet — may need more time"));
    return false;
  } catch (err) {
    console.log(red(`  Signal: failed to start daemon — ${err instanceof Error ? err.message : err}`));
    return false;
  }
}

/** Stop the signal-cli daemon if we started it */
export async function stopSignalDaemon(): Promise<void> {
  const pidPath = signalPidPath();
  if (!existsSync(pidPath)) return;

  try {
    const pid = parseInt(await readFile(pidPath, "utf-8"), 10);
    process.kill(pid, "SIGTERM");
    await unlink(pidPath);
    console.log(dim("  Signal: daemon stopped"));
  } catch {
    try { await unlink(pidPath); } catch {}
  }
}

/**
 * Interactive Signal setup wizard.
 * Guides through: prerequisites → registration → verification → config.
 */
export async function runSignalSetup(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("");
    console.log(bold("  Signal Setup"));
    console.log("");
    console.log("  This will configure Clank to send and receive Signal messages.");
    console.log("  You'll need a phone number that can receive SMS or voice calls.");
    console.log("");

    // Step 1: Check Java
    console.log(dim("  Checking prerequisites..."));

    if (!javaInstalled()) {
      console.log(yellow("  Java is required but not installed."));
      console.log("");
      const os = platform();
      if (os === "win32") {
        console.log("  Install Java:");
        console.log(dim("    winget install Microsoft.OpenJDK.21"));
        console.log(dim("    — or download from https://adoptium.net/"));
      } else if (os === "darwin") {
        console.log("  Install Java:");
        console.log(dim("    brew install openjdk"));
      } else {
        console.log("  Install Java:");
        console.log(dim("    sudo apt install default-jre     # Debian/Ubuntu"));
        console.log(dim("    sudo dnf install java-latest     # Fedora"));
        console.log(dim("    sudo pacman -S jre-openjdk       # Arch"));
      }
      console.log("");
      const proceed = await ask(rl, cyan("  Install Java and come back, or continue anyway? [c]ontinue / [q]uit: "));
      if (proceed.toLowerCase() === "q") return;
    } else {
      console.log(green("  Java: installed"));
    }

    // Step 2: Check signal-cli
    if (!commandExists("signal-cli")) {
      console.log(yellow("  signal-cli not found on PATH."));
      console.log("");
      console.log("  Install signal-cli:");
      const os = platform();
      if (os === "darwin") {
        console.log(dim("    brew install signal-cli"));
      } else if (os === "win32") {
        console.log(dim("    1. Download from https://github.com/AsamK/signal-cli/releases"));
        console.log(dim("    2. Extract to a folder (e.g., C:\\signal-cli\\)"));
        console.log(dim("    3. Add to PATH: setx PATH \"%PATH%;C:\\signal-cli\\bin\""));
      } else {
        console.log(dim("    # Download latest release:"));
        console.log(dim("    curl -L https://github.com/AsamK/signal-cli/releases/latest/download/signal-cli-0.13.2-Linux.tar.gz | tar xz"));
        console.log(dim("    sudo mv signal-cli-0.13.2/bin/signal-cli /usr/local/bin/"));
        console.log(dim("    sudo mv signal-cli-0.13.2/lib /usr/local/lib/signal-cli"));
      }
      console.log("");
      const proceed = await ask(rl, cyan("  Install signal-cli and come back, or continue anyway? [c]ontinue / [q]uit: "));
      if (proceed.toLowerCase() === "q") return;

      // Re-check
      if (!commandExists("signal-cli")) {
        console.log(yellow("  signal-cli still not found. You can configure manually and come back."));
        console.log(dim("  Clank will manage the daemon once signal-cli is installed."));
      }
    } else {
      console.log(green("  signal-cli: installed"));
    }

    // Step 3: Phone number
    console.log("");
    const phone = await ask(rl, cyan("  Your phone number (e.g., +15551234567): "));
    if (!phone.trim() || !phone.trim().startsWith("+")) {
      console.log(yellow("  Invalid phone number. Must start with +country code."));
      return;
    }
    const account = phone.trim();

    // Step 4: Registration
    console.log("");
    console.log("  Registration method:");
    console.log("  1. SMS verification (default)");
    console.log("  2. Voice call verification");
    console.log("  3. Skip — already registered on this machine");
    const regChoice = await ask(rl, cyan("  Choice [1]: "));

    if (regChoice !== "3") {
      const method = regChoice === "2" ? "--voice" : "";

      if (commandExists("signal-cli")) {
        console.log(dim("  Sending verification code..."));
        try {
          const cmd = `signal-cli -a ${account} register ${method}`.trim();
          execSync(cmd, { stdio: "inherit" });
          console.log("");
          const code = await ask(rl, cyan("  Verification code (from SMS/call): "));
          if (code.trim()) {
            try {
              execSync(`signal-cli -a ${account} verify ${code.trim()}`, { stdio: "inherit" });
              console.log(green("  Phone number verified!"));
            } catch {
              console.log(yellow("  Verification failed. You may need to try again."));
            }
          }
        } catch (err) {
          console.log(yellow(`  Registration failed: ${err instanceof Error ? err.message : err}`));
          console.log(dim("  You can register manually: signal-cli -a " + account + " register"));
        }
      } else {
        console.log(dim("  signal-cli not installed — register manually later:"));
        console.log(dim(`    signal-cli -a ${account} register`));
        console.log(dim(`    signal-cli -a ${account} verify CODE`));
      }
    } else {
      console.log(green("  Skipping registration — using existing account"));
    }

    // Step 5: Endpoint configuration
    console.log("");
    const endpoint = await ask(rl, cyan("  Daemon endpoint [http://localhost:7583]: "));
    const finalEndpoint = endpoint.trim() || "http://localhost:7583";

    // Step 6: Allowlist
    console.log("");
    console.log(dim("  Who can message your agent via Signal?"));
    const allowPhone = await ask(rl, cyan("  Allowed phone number(s) (comma-separated, or Enter for your number only): "));
    const allowFrom = allowPhone.trim()
      ? allowPhone.split(",").map((p) => p.trim()).filter(Boolean)
      : [account];

    // Step 7: Save config
    const config = await loadConfig();
    config.channels.signal = {
      enabled: true,
      endpoint: finalEndpoint,
      account,
      allowFrom,
    };
    await saveConfig(config);

    console.log("");
    console.log(green("  Signal configured!"));
    console.log("");
    console.log("  Clank will automatically start and stop the signal-cli daemon");
    console.log("  alongside the gateway when Signal is enabled.");
    console.log("");

    // Step 8: Try starting the daemon now
    if (commandExists("signal-cli")) {
      const startNow = await ask(rl, cyan("  Start the Signal daemon now? [Y/n] "));
      if (startNow.toLowerCase() !== "n") {
        await startSignalDaemon(account, finalEndpoint);
      }
    }

    console.log("");
    console.log(dim("  To disable Signal later: set channels.signal.enabled = false in config"));
    console.log(dim("  To re-run this wizard: clank setup --signal"));
    console.log("");
  } finally {
    rl.close();
  }
}
