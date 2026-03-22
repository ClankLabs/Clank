/**
 * `clank fix` — Diagnostics & repair utility.
 *
 * Checks all systems and reports issues. Auto-fix mode
 * attempts safe repairs for common problems.
 */

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir, getConfigPath, loadConfig } from "../config/index.js";
import { OllamaProvider } from "../providers/ollama.js";
import { DEFAULT_PORT } from "../gateway/protocol.js";

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const check = green("✓");
const cross = red("✗");
const warn = yellow("!");

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "error";
  message: string;
  fix?: string;
}

export async function runFix(opts: { auto?: boolean; check?: string }): Promise<void> {
  console.log("");
  console.log("  Clank Diagnostics");
  console.log("");

  const results: CheckResult[] = [];

  // Only run specific check if requested
  const checks = opts.check ? [opts.check] : ["config", "gateway", "models", "sessions", "workspace"];

  if (checks.includes("config")) results.push(await checkConfig());
  if (checks.includes("gateway")) results.push(await checkGateway());
  if (checks.includes("models")) results.push(await checkModels());
  if (checks.includes("sessions")) results.push(await checkSessions());
  if (checks.includes("workspace")) results.push(await checkWorkspace());

  // Print results
  for (const r of results) {
    const icon = r.status === "ok" ? check : r.status === "warn" ? warn : cross;
    console.log(`  ${icon} ${r.name.padEnd(18)} ${r.message}`);
    if (r.fix && r.status !== "ok") {
      console.log(dim(`    → ${r.fix}`));
    }
  }

  const issues = results.filter((r) => r.status !== "ok");
  console.log("");
  if (issues.length === 0) {
    console.log(green("  All checks passed."));
  } else {
    console.log(yellow(`  ${issues.length} issue${issues.length > 1 ? "s" : ""} found.`));
  }
  console.log("");
}

async function checkConfig(): Promise<CheckResult> {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return {
      name: "Config",
      status: "warn",
      message: "No config file found",
      fix: "Run: clank setup",
    };
  }

  try {
    await loadConfig();
    return { name: "Config", status: "ok", message: "valid" };
  } catch (err) {
    return {
      name: "Config",
      status: "error",
      message: `parse error: ${err instanceof Error ? err.message : err}`,
      fix: "Check config.json5 for syntax errors",
    };
  }
}

async function checkGateway(): Promise<CheckResult> {
  const config = await loadConfig();
  const port = config.gateway.port || DEFAULT_PORT;

  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      return { name: "Gateway", status: "ok", message: `running on :${port}` };
    }
    return { name: "Gateway", status: "error", message: `unhealthy on :${port}` };
  } catch {
    return {
      name: "Gateway",
      status: "warn",
      message: "not running",
      fix: "Run: clank gateway start",
    };
  }
}

async function checkModels(): Promise<CheckResult> {
  const config = await loadConfig();
  const modelId = config.agents.defaults.model.primary;
  const provider = modelId.split("/")[0];

  if (provider === "ollama") {
    const models = await OllamaProvider.detect(config.models.providers.ollama?.baseUrl);
    if (models) {
      return { name: "Model (primary)", status: "ok", message: `${modelId} — ${models.length} models available` };
    }
    return {
      name: "Model (primary)",
      status: "error",
      message: "Ollama not reachable",
      fix: "Start Ollama: ollama serve",
    };
  }

  if (provider === "anthropic") {
    if (config.models.providers.anthropic?.apiKey) {
      return { name: "Model (primary)", status: "ok", message: `${modelId} — key configured` };
    }
    return {
      name: "Model (primary)",
      status: "error",
      message: "Anthropic API key not set",
      fix: "Run: clank setup --section model",
    };
  }

  return { name: "Model (primary)", status: "ok", message: modelId };
}

async function checkSessions(): Promise<CheckResult> {
  const sessDir = join(getConfigDir(), "conversations");
  if (!existsSync(sessDir)) {
    return { name: "Sessions", status: "ok", message: "no sessions yet" };
  }

  try {
    const files = await readdir(sessDir);
    const count = files.filter((f) => f.endsWith(".json") && f !== "sessions.json").length;
    return { name: "Sessions", status: "ok", message: `${count} session${count !== 1 ? "s" : ""}` };
  } catch {
    return { name: "Sessions", status: "warn", message: "could not read sessions directory" };
  }
}

async function checkWorkspace(): Promise<CheckResult> {
  const wsDir = join(getConfigDir(), "workspace");
  if (!existsSync(wsDir)) {
    return {
      name: "Workspace",
      status: "warn",
      message: "not created yet",
      fix: "Run: clank setup",
    };
  }
  return { name: "Workspace", status: "ok", message: "present" };
}
