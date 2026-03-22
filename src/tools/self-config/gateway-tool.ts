/**
 * Gateway tool — check gateway status, connected clients, health.
 */

import { loadConfig } from "../../config/index.js";
import { DEFAULT_PORT } from "../../gateway/protocol.js";
import type { Tool, ValidationResult } from "../types.js";

export const gatewayTool: Tool = {
  definition: {
    name: "gateway_status",
    description: "Check the gateway daemon status, connected clients, and system health.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", description: "'status' or 'health'" },
      },
    },
  },

  safetyLevel: "low",
  readOnly: true,

  validate(): ValidationResult {
    return { ok: true };
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const config = await loadConfig();
    const port = config.gateway.port || DEFAULT_PORT;

    try {
      const endpoint = (args.action === "health") ? "health" : "status";
      const res = await fetch(`http://127.0.0.1:${port}/${endpoint}`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        return JSON.stringify(data, null, 2);
      }
      return `Gateway returned error: ${res.status}`;
    } catch {
      return `Gateway not reachable at http://127.0.0.1:${port}`;
    }
  },
};
