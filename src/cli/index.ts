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
let version = "0.1.0";
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
    console.log("Restart: stop + start the gateway manually for now.");
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

// Default: if no subcommand, launch TUI (or direct chat if no gateway)
program.action(async () => {
  const { runTui } = await import("./tui.js");
  await runTui({});
});

program.parse();
