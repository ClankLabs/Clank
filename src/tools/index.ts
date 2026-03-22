export type { Tool, ToolContext, ToolTier, SafetyLevel, ValidationResult } from "./types.js";
export { CORE_TOOL_NAMES, AUTO_TIER_TRIGGERS } from "./types.js";
export { ToolRegistry } from "./registry.js";

// Core tools
export { readFileTool } from "./read-file.js";
export { writeFileTool } from "./write-file.js";
export { editFileTool } from "./edit-file.js";
export { listDirectoryTool } from "./list-directory.js";
export { searchFilesTool } from "./search-files.js";
export { globFilesTool } from "./glob-files.js";
export { bashTool } from "./bash.js";
export { gitTool } from "./git.js";

import { ToolRegistry } from "./registry.js";
import { readFileTool } from "./read-file.js";
import { writeFileTool } from "./write-file.js";
import { editFileTool } from "./edit-file.js";
import { listDirectoryTool } from "./list-directory.js";
import { searchFilesTool } from "./search-files.js";
import { globFilesTool } from "./glob-files.js";
import { bashTool } from "./bash.js";
import { gitTool } from "./git.js";
import { registerSelfConfigTools } from "./self-config/index.js";

// Self-config tools
export { registerSelfConfigTools } from "./self-config/index.js";

/**
 * Create a ToolRegistry pre-loaded with all core tools.
 */
export function createCoreRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(editFileTool);
  registry.register(listDirectoryTool);
  registry.register(searchFilesTool);
  registry.register(globFilesTool);
  registry.register(bashTool);
  registry.register(gitTool);
  return registry;
}

/**
 * Create a full registry with core + self-config tools.
 * Used when the agent should be able to configure itself.
 */
export function createFullRegistry(): ToolRegistry {
  const registry = createCoreRegistry();
  registerSelfConfigTools(registry);
  return registry;
}
