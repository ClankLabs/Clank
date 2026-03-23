export { configTool } from "./config-tool.js";
export { channelTool } from "./channel-tool.js";
export { agentTool } from "./agent-tool.js";
export { modelTool } from "./model-tool.js";
export { sessionTool } from "./session-tool.js";
export { cronTool } from "./cron-tool.js";
export { gatewayTool } from "./gateway-tool.js";
export { messageTool } from "./message-tool.js";
export { ttsTool, sttTool, voiceListTool } from "./voice-tool.js";

import type { ToolRegistry } from "../registry.js";
import { configTool } from "./config-tool.js";
import { channelTool } from "./channel-tool.js";
import { agentTool } from "./agent-tool.js";
import { modelTool } from "./model-tool.js";
import { sessionTool } from "./session-tool.js";
import { cronTool } from "./cron-tool.js";
import { gatewayTool } from "./gateway-tool.js";
import { messageTool } from "./message-tool.js";
import { ttsTool, sttTool, voiceListTool } from "./voice-tool.js";

/** Register all self-configuration tools into a registry */
export function registerSelfConfigTools(registry: ToolRegistry): void {
  registry.register(configTool);
  registry.register(channelTool);
  registry.register(agentTool);
  registry.register(modelTool);
  registry.register(sessionTool);
  registry.register(cronTool);
  registry.register(gatewayTool);
  registry.register(messageTool);
  registry.register(ttsTool);
  registry.register(sttTool);
  registry.register(voiceListTool);
}
