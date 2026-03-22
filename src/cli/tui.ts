/**
 * Terminal UI (TUI) — rich interactive chat interface.
 *
 * Connects to the gateway via WebSocket (same protocol as Web UI).
 * Features: streaming, tool call cards, thinking blocks, agent/model/session
 * pickers, status bar, slash commands, shell integration.
 *
 * Keyboard shortcuts:
 *   Enter     — Send message
 *   Esc       — Abort current response
 *   Ctrl+L    — Model picker
 *   Ctrl+G    — Agent picker
 *   Ctrl+P    — Session picker
 *   Ctrl+O    — Toggle tool output
 *   Ctrl+T    — Toggle thinking visibility
 *   Ctrl+C    — Clear input (twice to exit)
 *   Ctrl+D    — Exit
 */

import { createInterface } from "node:readline";
import WebSocket from "ws";
import { loadConfig, getConfigDir } from "../config/index.js";
import { DEFAULT_PORT, type HelloFrame, type EventFrame, type ResponseFrame } from "../gateway/protocol.js";

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const italic = (s: string) => `\x1b[3m${s}\x1b[0m`;

interface TuiState {
  ws: WebSocket | null;
  connected: boolean;
  agentId: string;
  agentName: string;
  modelId: string;
  sessionKey: string;
  agents: Array<{ id: string; name: string; model: string }>;
  sessions: Array<{ key: string; label?: string }>;
  streaming: boolean;
  showThinking: boolean;
  showToolOutput: boolean;
  reqId: number;
  ctrlCCount: number;
}

export async function runTui(opts: {
  url?: string;
  token?: string;
  session?: string;
}): Promise<void> {
  const config = await loadConfig();
  const port = config.gateway.port || DEFAULT_PORT;
  const wsUrl = opts.url || `ws://127.0.0.1:${port}`;
  const token = opts.token || config.gateway.auth.token || "";

  const state: TuiState = {
    ws: null,
    connected: false,
    agentId: "default",
    agentName: "Clank",
    modelId: config.agents.defaults.model.primary,
    sessionKey: opts.session || "tui:main",
    agents: [],
    sessions: [],
    streaming: false,
    showThinking: false,
    showToolOutput: true,
    reqId: 0,
    ctrlCCount: 0,
  };

  // Check if gateway is running, if not fall back to direct mode
  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) });
    if (!health.ok) throw new Error("not ok");
  } catch {
    console.log(dim("  Gateway not running. Starting direct mode..."));
    console.log(dim("  (Start gateway with: clank gateway start)"));
    console.log("");
    const { runChat } = await import("./chat.js");
    await runChat({ direct: true });
    return;
  }

  console.log("");
  console.log(bold("  Clank TUI") + dim(` | connecting to ${wsUrl}...`));

  // Connect to gateway
  const ws = new WebSocket(wsUrl);
  state.ws = ws;

  ws.on("open", () => {
    // Send connect handshake
    ws.send(JSON.stringify({
      type: "connect",
      params: { auth: { token }, mode: "tui", version: "0.1.0" },
    }));
  });

  ws.on("message", (data) => {
    const frame = JSON.parse(data.toString());
    handleFrame(state, frame);
  });

  ws.on("close", () => {
    state.connected = false;
    console.log(red("\n  Disconnected from gateway."));
    process.exit(0);
  });

  ws.on("error", (err) => {
    console.error(red(`  Connection error: ${err.message}`));
    process.exit(1);
  });

  // Set up readline
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  // Wait for connection before prompting
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (state.connected) { clearInterval(check); resolve(); }
    }, 100);
    setTimeout(() => { clearInterval(check); resolve(); }, 5000);
  });

  if (!state.connected) {
    console.log(red("  Failed to connect to gateway."));
    process.exit(1);
  }

  // Print header
  printStatusBar(state);
  console.log(dim("  Type your message. /help for commands. Ctrl+D to exit.\n"));

  rl.setPrompt(cyan("you > "));
  rl.prompt();

  rl.on("line", async (line) => {
    const input = line.trim();
    state.ctrlCCount = 0;

    if (!input) { rl.prompt(); return; }

    // Shell integration: ! prefix runs commands on host
    if (input.startsWith("!")) {
      const cmd = input.slice(1).trim();
      if (cmd) {
        const { execSync } = await import("node:child_process");
        try {
          const out = execSync(cmd, { encoding: "utf-8", timeout: 30000, env: { ...process.env, CLANK_SHELL: "tui-local" } });
          console.log(out);
        } catch (err: any) {
          console.log(red(err.stderr || err.message));
        }
      }
      rl.prompt();
      return;
    }

    // Slash commands
    if (input.startsWith("/")) {
      await handleSlashCommand(state, input, rl);
      rl.prompt();
      return;
    }

    // Send message to agent
    console.log("");
    state.streaming = true;
    state.reqId++;

    state.ws?.send(JSON.stringify({
      type: "req",
      id: state.reqId,
      method: "chat.send",
      params: { message: input, sessionKey: state.sessionKey, agent: state.agentId },
    }));

    // Wait for response to complete
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!state.streaming) { clearInterval(check); resolve(); }
      }, 100);
    });

    console.log("");
    rl.prompt();
  });

  rl.on("close", () => {
    ws.close();
    process.exit(0);
  });

  // Handle Ctrl+C
  process.on("SIGINT", () => {
    if (state.streaming) {
      state.ws?.send(JSON.stringify({ type: "req", id: ++state.reqId, method: "chat.abort", params: {} }));
      state.streaming = false;
      console.log(dim("\n  (aborted)"));
      rl.prompt();
    } else {
      state.ctrlCCount++;
      if (state.ctrlCCount >= 2) {
        ws.close();
        process.exit(0);
      }
      console.log(dim("\n  Press Ctrl+C again to exit, or Ctrl+D."));
      rl.prompt();
    }
  });
}

function handleFrame(state: TuiState, frame: any): void {
  // Hello response
  if (frame.type === "hello") {
    const hello = frame as HelloFrame;
    state.connected = true;
    state.agents = hello.agents || [];
    state.sessions = hello.sessions || [];
    if (state.agents.length > 0) {
      state.agentId = state.agents[0].id;
      state.agentName = state.agents[0].name;
      state.modelId = state.agents[0].model;
    }
    console.log(green(`  Connected`) + dim(` | agent: ${state.agentName} | model: ${state.modelId}`));
    return;
  }

  // Events
  if (frame.type === "event") {
    const event = frame as EventFrame;
    switch (event.event) {
      case "chat.stream":
      case "token":
        process.stdout.write((event.payload as any).text || (event.payload as any).content || "");
        break;

      case "chat.thinking":
      case "thinking":
        if (state.showThinking) {
          process.stdout.write(dim(italic((event.payload as any).text || "")));
        }
        break;

      case "chat.tool":
      case "tool-start": {
        const p = event.payload as any;
        if (state.showToolOutput) {
          console.log(dim(`\n  [${p.name}] ${(p.args ? JSON.stringify(p.args) : "").slice(0, 80)}`));
        }
        break;
      }

      case "tool-result": {
        const p = event.payload as any;
        if (state.showToolOutput) {
          const icon = p.success ? green("ok") : red("err");
          console.log(dim(`  [${p.name}] ${icon} ${(p.summary || "").slice(0, 80)}`));
        }
        break;
      }

      case "chat.complete":
      case "response-end":
      case "turn-complete":
        state.streaming = false;
        break;

      case "chat.error":
      case "error":
        console.log(red(`\n  Error: ${(event.payload as any).message || (event.payload as any).error || "Unknown"}`));
        state.streaming = false;
        break;

      case "usage": {
        const u = event.payload as any;
        console.log(dim(`\n  [${u.promptTokens}→${u.outputTokens} tokens | ctx ${u.contextPercent}%]`));
        break;
      }
    }
    return;
  }

  // Response frames
  if (frame.type === "res") {
    const res = frame as ResponseFrame;
    if (!res.ok && res.error) {
      console.log(red(`\n  Error: ${res.error}`));
    }
    state.streaming = false;
  }
}

async function handleSlashCommand(state: TuiState, input: string, rl: any): Promise<void> {
  const [cmd, ...args] = input.slice(1).split(/\s+/);

  switch (cmd) {
    case "help":
      console.log(dim("  Commands:"));
      console.log(dim("    /help                — This help"));
      console.log(dim("    /status              — Gateway and agent status"));
      console.log(dim("    /agent [name]        — Switch or list agents"));
      console.log(dim("    /session [key]       — Switch or list sessions"));
      console.log(dim("    /model [id]          — Show current model"));
      console.log(dim("    /think               — Toggle thinking display"));
      console.log(dim("    /tools               — Toggle tool output"));
      console.log(dim("    /new                 — Start new session"));
      console.log(dim("    /reset               — Reset current session"));
      console.log(dim("    /exit                — Exit"));
      console.log(dim("    !<command>           — Run shell command"));
      break;

    case "status":
      console.log(dim(`  Agent: ${state.agentName} (${state.agentId})`));
      console.log(dim(`  Model: ${state.modelId}`));
      console.log(dim(`  Session: ${state.sessionKey}`));
      console.log(dim(`  Connected: ${state.connected}`));
      break;

    case "agent":
      if (args[0]) {
        const agent = state.agents.find((a) => a.id === args[0] || a.name.toLowerCase() === args[0].toLowerCase());
        if (agent) {
          state.agentId = agent.id;
          state.agentName = agent.name;
          state.modelId = agent.model;
          state.sessionKey = `tui:${agent.id}:main`;
          console.log(green(`  Switched to ${agent.name} (${agent.model})`));
        } else {
          console.log(red(`  Agent not found: ${args[0]}`));
        }
      } else {
        console.log(dim("  Agents:"));
        for (const a of state.agents) {
          const active = a.id === state.agentId ? " ←" : "";
          console.log(dim(`    ${a.id}: ${a.name} (${a.model})${active}`));
        }
        if (state.agents.length === 0) console.log(dim("    (no custom agents)"));
      }
      break;

    case "session":
      if (args[0]) {
        state.sessionKey = args[0];
        console.log(green(`  Switched to session: ${args[0]}`));
      } else {
        console.log(dim("  Sessions:"));
        for (const s of state.sessions.slice(0, 20)) {
          const active = s.key === state.sessionKey ? " ←" : "";
          console.log(dim(`    ${s.key}: ${s.label || "(untitled)"}${active}`));
        }
        if (state.sessions.length === 0) console.log(dim("    (no sessions)"));
      }
      break;

    case "model":
      console.log(dim(`  Current model: ${state.modelId}`));
      break;

    case "think":
      state.showThinking = !state.showThinking;
      console.log(dim(`  Thinking display: ${state.showThinking ? "on" : "off"}`));
      break;

    case "tools":
      state.showToolOutput = !state.showToolOutput;
      console.log(dim(`  Tool output: ${state.showToolOutput ? "on" : "off"}`));
      break;

    case "new":
      state.sessionKey = `tui:${state.agentId}:${Date.now()}`;
      console.log(green(`  New session: ${state.sessionKey}`));
      break;

    case "reset":
      state.ws?.send(JSON.stringify({
        type: "req", id: ++state.reqId, method: "session.reset",
        params: { sessionKey: state.sessionKey },
      }));
      console.log(green("  Session reset"));
      break;

    case "exit":
    case "quit":
      state.ws?.close();
      process.exit(0);

    default:
      console.log(dim(`  Unknown command: /${cmd}. Type /help for commands.`));
  }
}

function printStatusBar(state: TuiState): void {
  console.log(dim(`  ${state.agentName} | ${state.modelId} | ${state.sessionKey}`));
}
