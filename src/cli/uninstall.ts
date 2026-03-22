/**
 * `clank uninstall` — remove everything.
 *
 * Stops the gateway, removes the daemon, deletes all data
 * (config, sessions, memory, workspace, logs, plugins, cron),
 * and unlinks the global npm package.
 */

import { createInterface } from "node:readline";
import { rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { getConfigDir } from "../config/index.js";
import { gatewayStop } from "./gateway-cmd.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

export async function runUninstall(opts: { yes?: boolean }): Promise<void> {
  const configDir = getConfigDir();

  console.log("");
  console.log(bold("  Uninstall Clank"));
  console.log("");
  console.log("  This will permanently remove:");
  console.log(red(`    ${configDir}`));
  console.log(dim("    ├── config.json5       (configuration)"));
  console.log(dim("    ├── conversations/     (chat history)"));
  console.log(dim("    ├── memory/            (agent memory)"));
  console.log(dim("    ├── workspace/         (SOUL.md, USER.md, etc.)"));
  console.log(dim("    ├── logs/              (gateway logs)"));
  console.log(dim("    ├── cron/              (scheduled jobs)"));
  console.log(dim("    └── plugins/           (installed plugins)"));
  console.log("");

  if (!opts.yes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(yellow("  Are you sure? This cannot be undone. [y/N] "), resolve);
    });
    rl.close();

    if (answer.trim().toLowerCase() !== "y") {
      console.log(dim("  Uninstall cancelled."));
      return;
    }
  }

  // Step 1: Stop gateway
  console.log(dim("  Stopping gateway..."));
  try {
    await gatewayStop();
  } catch {
    // May not be running
  }

  // Step 2: Remove daemon/service
  console.log(dim("  Removing system service..."));
  try {
    const { uninstallDaemon } = await import("../daemon/index.js");
    await uninstallDaemon();
  } catch {
    // May not be installed
  }

  // Step 3: Delete all data
  console.log(dim("  Deleting data..."));
  if (existsSync(configDir)) {
    await rm(configDir, { recursive: true, force: true });
    console.log(green(`  Removed ${configDir}`));
  } else {
    console.log(dim("  No data directory found."));
  }

  // Step 4: Unlink global package
  console.log(dim("  Uninstalling npm package..."));
  try {
    const { execSync } = await import("node:child_process");
    execSync("npm uninstall -g clank", { stdio: "ignore" });
    console.log(green("  npm package uninstalled"));
  } catch {
    console.log(dim("  Could not uninstall npm package (may not be globally installed)"));
  }

  console.log("");
  console.log(green("  Clank has been completely removed."));
  console.log("");
}
