import { execFile } from "node:child_process";
import { resolve, isAbsolute } from "node:path";
import { platform } from "node:os";
import type { Tool, ToolContext, ValidationResult } from "./types.js";

/** Commands that are blocked for safety — defense in depth */
const BLOCKED_PATTERNS = [
  // Recursive deletion of root/system dirs
  /rm\s+.*-[a-z]*r[a-z]*f[a-z]*\s+\//i,
  /rm\s+.*-[a-z]*f[a-z]*r[a-z]*\s+\//i,
  /rm\s+.*--recursive.*\//i,
  /rm\s+.*--force.*\//i,
  /Remove-Item.*-Recurse/i,
  /del\s+\/[sS].*[\\\/]/i,
  /rd\s+\/[sS].*[\\\/]/i,
  // Disk formatting
  /\bformat\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bdd\s+.*of=\/dev/i,
  /diskpart/i,
  // Force push to main branches
  /git\s+push\s+.*(-f|--force).*\b(main|master)\b/i,
  /git\s+push\s+.*\b(main|master)\b.*(-f|--force)/i,
  // Shell-in-shell execution (limits encoded payloads)
  /\|\s*(bash|sh|cmd|powershell|pwsh)\b/i,
  /base64\s+(-d|--decode).*\|\s*(bash|sh)/i,
  // Direct system damage
  /\bchmod\s+.*777\s+\//i,
  /\bchown\s+.*\//i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  // Windows-specific
  /powershell\s+.*-[eE]ncodedCommand/i,
  /reg\s+(delete|add).*\\\\HKLM/i,
];

const MAX_OUTPUT = 30 * 1024; // 30KB output cap
const TIMEOUT_MS = 120_000;    // 2 minute timeout

export const bashTool: Tool = {
  definition: {
    name: "bash",
    description:
      "Execute a shell command. Use for system operations, builds, installs, etc. " +
      "Output is capped at 30KB. Times out after 2 minutes. " +
      "Dangerous commands (rm -rf /, format, etc.) are blocked.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The shell command to execute" },
        cwd: { type: "string", description: "Working directory (default: workspace root)" },
        timeout: { type: "number", description: "Timeout in milliseconds (default: 120000)" },
      },
      required: ["command"],
    },
  },

  safetyLevel: "high",
  readOnly: false,

  validate(args: Record<string, unknown>, _ctx: ToolContext): ValidationResult {
    if (!args.command || typeof args.command !== "string") {
      return { ok: false, error: "command is required" };
    }

    const cmd = args.command as string;
    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(cmd)) {
        return { ok: false, error: `Blocked: dangerous command pattern detected` };
      }
    }

    return { ok: true };
  },

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const command = args.command as string;
    const cwd = args.cwd
      ? isAbsolute(args.cwd as string)
        ? (args.cwd as string)
        : resolve(ctx.projectRoot, args.cwd as string)
      : ctx.projectRoot;
    const timeout = Number(args.timeout) || TIMEOUT_MS;

    const shell = platform() === "win32" ? "cmd.exe" : "/bin/bash";
    const shellArgs = platform() === "win32" ? ["/c", command] : ["-c", command];

    return new Promise<string>((resolvePromise) => {
      execFile(
        shell,
        shellArgs,
        {
          cwd,
          timeout,
          maxBuffer: MAX_OUTPUT * 2,
          signal: ctx.signal,
        },
        (error, stdout, stderr) => {
          let output = "";

          if (stdout) output += stdout;
          if (stderr) output += (output ? "\n" : "") + stderr;

          // Cap output
          if (output.length > MAX_OUTPUT) {
            output = output.slice(0, MAX_OUTPUT) + "\n... (output truncated)";
          }

          if (error && !output) {
            output = `Error: ${error.message}`;
          }

          if (error && "code" in error) {
            output += `\n(exit code: ${(error as NodeJS.ErrnoException & { code?: number }).code})`;
          }

          resolvePromise(output || "(no output)");
        },
      );
    });
  },

  formatConfirmation(args: Record<string, unknown>): string {
    return `Run: ${args.command}`;
  },
};
