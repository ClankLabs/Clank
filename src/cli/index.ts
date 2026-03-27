#!/usr/bin/env node

/**
 * Clank — Local-first AI agent gateway
 *
 * Entry point for the `clank` CLI command.
 * Routes to subcommands: chat, gateway, setup, fix, models, agents, daemon.
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Read version from package.json
let version = "1.8.0";
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf-8"));
  version = pkg.version;
} catch {
  // Use default version
}

const program = new Command();

program
  .name("clank")
  .description("Local-first AI agent gateway")
  .version(version, "-v, --version");

// clank chat — interactive chat (connects to gateway or direct mode)
program
  .command("chat")
  .description("Start an interactive chat session")
  .option("--web", "Open chat in browser")
  .option("--new", "Start a fresh session")
  .option("--continue", "Resume last session")
  .option("--session <id>", "Resume a specific session")
  .option("--direct", "Force direct mode (no gateway)")
  .action(async (opts) => {
    const { runChat } = await import("./chat.js");
    await runChat(opts);
  });

// clank gateway — manage the gateway daemon
const gateway = program
  .command("gateway")
  .description("Manage the gateway daemon");

gateway
  .command("start")
  .description("Start the gateway daemon")
  .option("-p, --port <port>", "Port to listen on")
  .option("--foreground", "Run in foreground (don't daemonize)")
  .action(async (opts) => {
    const { gatewayStart } = await import("./gateway-cmd.js");
    await gatewayStart(opts);
  });

gateway
  .command("stop")
  .description("Stop the gateway daemon")
  .action(async () => {
    const { gatewayStop } = await import("./gateway-cmd.js");
    await gatewayStop();
  });

gateway
  .command("status")
  .description("Show gateway status")
  .action(async () => {
    const { gatewayStatus } = await import("./gateway-cmd.js");
    await gatewayStatus();
  });

gateway
  .command("restart")
  .description("Restart the gateway daemon")
  .action(async () => {
    const { gatewayStop, gatewayStartBackground } = await import("./gateway-cmd.js");
    await gatewayStop();
    await new Promise((r) => setTimeout(r, 1000));
    await gatewayStartBackground();
  });

// clank setup — onboarding wizard
program
  .command("setup")
  .description("Run the onboarding wizard")
  .option("--quick", "Quick Start with sensible defaults")
  .option("--advanced", "Advanced setup with full control")
  .option("--section <name>", "Reconfigure a specific section")
  .option("--non-interactive", "Non-interactive mode for scripting")
  .option("--accept-risk", "Accept security disclaimer")
  .action(async (opts) => {
    const { runSetup } = await import("./setup.js");
    await runSetup(opts);
  });

// clank fix — diagnostics & repair
program
  .command("fix")
  .description("Run diagnostics and repair")
  .option("--auto", "Attempt automatic repairs")
  .option("--check <system>", "Check a specific system")
  .action(async (opts) => {
    const { runFix } = await import("./fix.js");
    await runFix(opts);
  });

// clank models — model management
const models = program
  .command("models")
  .description("Manage models and providers");

models
  .command("list")
  .description("List available models")
  .action(async () => {
    const { modelsList } = await import("./models.js");
    await modelsList();
  });

models
  .command("add")
  .description("Add a model provider")
  .action(async () => {
    const { modelsAdd } = await import("./models.js");
    await modelsAdd();
  });

models
  .command("test")
  .description("Test model connectivity")
  .action(async () => {
    const { modelsTest } = await import("./models.js");
    await modelsTest();
  });

// clank agents — agent management
const agents = program
  .command("agents")
  .description("Manage agents and routing");

agents
  .command("list")
  .description("List configured agents")
  .action(async () => {
    const { agentsList } = await import("./agents.js");
    await agentsList();
  });

agents
  .command("add")
  .description("Add a new agent")
  .action(async () => {
    const { agentsAdd } = await import("./agents.js");
    await agentsAdd();
  });

agents
  .command("routing")
  .description("Show routing rules")
  .action(async () => {
    const { agentsRouting } = await import("./agents.js");
    await agentsRouting();
  });

// clank daemon — system service management
const daemon = program
  .command("daemon")
  .description("Manage the system service");

daemon
  .command("install")
  .description("Install Clank as a system service")
  .action(async () => {
    const { installDaemon } = await import("../daemon/index.js");
    await installDaemon();
  });

daemon
  .command("uninstall")
  .description("Remove the system service")
  .action(async () => {
    const { uninstallDaemon } = await import("../daemon/index.js");
    await uninstallDaemon();
  });

daemon
  .command("status")
  .description("Show system service status")
  .action(async () => {
    const { daemonStatus } = await import("../daemon/index.js");
    await daemonStatus();
  });

// clank tui — launch TUI (connects to gateway)
program
  .command("tui")
  .description("Launch the terminal UI (connects to gateway)")
  .option("--url <url>", "Gateway WebSocket URL")
  .option("--token <token>", "Auth token")
  .option("--session <key>", "Session to resume")
  .action(async (opts) => {
    const { runTui } = await import("./tui.js");
    await runTui(opts);
  });

// clank dashboard — open Web UI in browser
program
  .command("dashboard")
  .description("Open the Web UI in your browser")
  .option("--no-open", "Don't auto-open browser")
  .action(async (opts) => {
    const { loadConfig } = await import("../config/index.js");
    const config = await loadConfig();
    const port = config.gateway.port || 18789;
    const token = config.gateway.auth.token || "";
    const url = `http://127.0.0.1:${port}/#token=${token}`;
    console.log(`\n  Web UI: ${url}\n`);
    if (opts.open !== false) {
      const { platform } = await import("node:os");
      const { exec } = await import("node:child_process");
      const cmd = platform() === "win32" ? `start ${url}` : platform() === "darwin" ? `open ${url}` : `xdg-open ${url}`;
      exec(cmd);
    }
  });

// clank pipeline — manage pipelines
const pipeline = program
  .command("pipeline")
  .description("Manage agent pipelines");

pipeline
  .command("list")
  .description("List pipeline definitions")
  .action(async () => {
    console.log("  No pipelines configured. Define pipelines in config or through conversation.");
  });

pipeline
  .command("run <name>")
  .description("Run a pipeline")
  .option("--input <text>", "Input text for the pipeline")
  .action(async (name, opts) => {
    console.log(`  Running pipeline: ${name}...`);
    console.log("  Pipeline CLI execution coming soon. Use the Web UI or conversation.");
  });

pipeline
  .command("status <id>")
  .description("Check pipeline execution status")
  .action(async (id) => {
    console.log(`  Pipeline ${id}: status check coming soon.`);
  });

// clank cron — manage cron jobs
const cron = program
  .command("cron")
  .description("Manage scheduled jobs");

cron
  .command("list")
  .description("List cron jobs")
  .action(async () => {
    const { join } = await import("node:path");
    const { getConfigDir } = await import("../config/index.js");
    const { CronScheduler } = await import("../cron/index.js");
    const scheduler = new CronScheduler(join(getConfigDir(), "cron"));
    await scheduler.init();
    const jobs = scheduler.listJobs();
    if (jobs.length === 0) { console.log("  No cron jobs."); return; }
    for (const j of jobs) {
      console.log(`  ${j.id.slice(0,8)} | ${j.name} | ${j.schedule} | ${j.enabled ? "enabled" : "disabled"} | agent: ${j.agentId}`);
    }
  });

cron
  .command("add")
  .description("Add a cron job")
  .requiredOption("--schedule <expr>", "Schedule (e.g., '1h', '30m', 'daily')")
  .requiredOption("--prompt <text>", "What the agent should do")
  .option("--name <name>", "Job name")
  .option("--agent <id>", "Agent ID", "default")
  .action(async (opts) => {
    const { join } = await import("node:path");
    const { getConfigDir } = await import("../config/index.js");
    const { CronScheduler } = await import("../cron/index.js");
    const scheduler = new CronScheduler(join(getConfigDir(), "cron"));
    await scheduler.init();
    const job = await scheduler.addJob({
      name: opts.name || "CLI Job",
      schedule: opts.schedule,
      agentId: opts.agent,
      prompt: opts.prompt,
    });
    console.log(`  Job created: ${job.id.slice(0,8)} — "${job.name}" every ${job.schedule}`);
  });

cron
  .command("remove <id>")
  .description("Remove a cron job")
  .action(async (id) => {
    const { join } = await import("node:path");
    const { getConfigDir } = await import("../config/index.js");
    const { CronScheduler } = await import("../cron/index.js");
    const scheduler = new CronScheduler(join(getConfigDir(), "cron"));
    await scheduler.init();
    const removed = await scheduler.removeJob(id);
    console.log(removed ? `  Job ${id.slice(0,8)} removed` : `  Job not found`);
  });

// clank channels — channel status
program
  .command("channels")
  .description("Show channel adapter status")
  .action(async () => {
    const { loadConfig } = await import("../config/index.js");
    const config = await loadConfig();
    const channels = config.channels || {};
    console.log("  Channels:");
    for (const [name, cfg] of Object.entries(channels)) {
      const c = cfg as Record<string, unknown>;
      console.log(`    ${name}: ${c.enabled ? "\x1b[32menabled\x1b[0m" : "\x1b[2mdisabled\x1b[0m"}`);
    }
    if (Object.keys(channels).length === 0) console.log("    (none configured)");
  });

// clank update — pull latest, rebuild, restart
program
  .command("update")
  .description("Update Clank to the latest version and restart gateway")
  .action(async () => {
    const { runUpdate } = await import("./update.js");
    await runUpdate();
  });

// clank uninstall — remove everything
program
  .command("uninstall")
  .description("Remove Clank completely (config, data, service, package)")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(async (opts) => {
    const { runUninstall } = await import("./uninstall.js");
    await runUninstall(opts);
  });

// Default: if no subcommand, ensure gateway is running then launch TUI
program.action(async () => {
  const { gatewayStartBackground, isGatewayRunning } = await import("./gateway-cmd.js");

  // Ensure gateway is running in the background (Telegram/Discord stay alive)
  if (!(await isGatewayRunning())) {
    await gatewayStartBackground();
  }

  // Launch TUI connected to the gateway
  const { runTui } = await import("./tui.js");
  await runTui({});
});

// clank auth — manage OAuth authentication
const auth = program
  .command("auth")
  .description("Manage OAuth authentication (Codex login)");

auth
  .command("login")
  .description("Sign in with your OpenAI account (ChatGPT Plus/Pro)")
  .action(async () => {
    const { runOAuthFlow } = await import("../auth/oauth.js");
    const { AuthProfileStore } = await import("../auth/credentials.js");
    try {
      const credential = await runOAuthFlow({
        onUrl: (url) => console.log(`\n  If browser didn't open:\n  ${url}\n`),
        onProgress: (msg) => console.log(`  ${msg}`),
      });
      const store = new AuthProfileStore();
      await store.setCredential("openai-codex:default", credential);
      console.log(`\n  Authenticated as ${credential.email}`);
      console.log(`  Account: ${credential.accountId}`);
      console.log(`  Token expires: ${new Date(credential.expires).toLocaleString()}`);
      console.log(`\n  Use model "codex/codex-mini-latest" in your agent config.`);
    } catch (err) {
      console.error(`  OAuth failed: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }
  });

auth
  .command("status")
  .description("Show stored authentication credentials")
  .action(async () => {
    const { AuthProfileStore } = await import("../auth/credentials.js");
    const store = new AuthProfileStore();
    const profiles = await store.listProfiles();
    if (profiles.length === 0) {
      console.log("  No stored credentials. Run 'clank auth login' to sign in.");
      return;
    }
    console.log("  Stored credentials:\n");
    for (const p of profiles) {
      const cred = await store.getCredential(p.id);
      const expiry = cred?.type === "oauth" ? new Date(cred.expires).toLocaleString() : "n/a";
      const expired = cred?.type === "oauth" && Date.now() >= cred.expires;
      console.log(`  ${p.id}`);
      console.log(`    Provider: ${p.provider}`);
      console.log(`    Type: ${p.type}`);
      if (p.email) console.log(`    Email: ${p.email}`);
      console.log(`    Expires: ${expiry}${expired ? " (EXPIRED — will auto-refresh)" : ""}`);
      console.log("");
    }
  });

auth
  .command("logout")
  .description("Remove stored OAuth credentials")
  .action(async () => {
    const { AuthProfileStore } = await import("../auth/credentials.js");
    const store = new AuthProfileStore();
    await store.removeCredential("openai-codex:default");
    console.log("  Credentials removed.");
  });

program.parse();
