/**
 * Update checker — runs on gateway launch.
 *
 * Checks the npm registry for a newer version of @clanklabs/clank.
 * If one exists, prompts the user Y/N. If declined or no update, continues.
 * Never auto-updates — the user always decides.
 */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

/**
 * Check for updates and prompt the user if one is available.
 * Returns true if the user chose to update (caller should exit after update).
 * Returns false if no update or user declined.
 *
 * @param currentVersion - The current installed version
 * @param interactive - If true, prompt Y/N. If false (background mode), just log.
 */
export async function checkForUpdate(currentVersion: string, interactive: boolean = true): Promise<boolean> {
  try {
    const res = await fetch("https://registry.npmjs.org/@clanklabs/clank/latest", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;

    const data = await res.json() as { version?: string };
    const latest = data.version;
    if (!latest) return false;

    // Compare versions (simple semver comparison)
    if (!isNewer(latest, currentVersion)) return false;

    // Update available
    console.log("");
    console.log(yellow(`  Update available: v${currentVersion} → v${latest}`));

    if (!interactive) {
      console.log(dim(`  Run 'clank update' to install`));
      return false;
    }

    // Prompt Y/N
    const { createInterface } = await import("node:readline");
    const rl = createInterface({ input: process.stdin, output: process.stdout });

    const answer = await new Promise<string>((resolve) => {
      rl.question(cyan("  Update now? [Y/n] "), resolve);
    });
    rl.close();

    if (answer.toLowerCase() === "n") {
      console.log(dim("  Skipped. Run 'clank update' anytime."));
      console.log("");
      return false;
    }

    // Run the update
    console.log(dim("  Updating..."));
    const { execSync } = await import("node:child_process");
    try {
      execSync("npm install -g @clanklabs/clank", { stdio: "inherit" });
      console.log(green(`  Updated to v${latest}`));
      console.log(dim("  Restart Clank to use the new version."));
      return true;
    } catch {
      console.log(yellow("  Update failed. Try manually: npm install -g @clanklabs/clank"));
      return false;
    }
  } catch {
    // Network error, timeout, etc. — silently continue
    return false;
  }
}

/** Compare semver strings. Returns true if `a` is newer than `b`. */
function isNewer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}
