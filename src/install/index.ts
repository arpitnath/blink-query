export { buildMcpEntry, defaultDbPath, detectAgents, detectNvm, getClaudeDesktopConfigPath, isCommandAvailable } from './detect.js';
export type { AgentName, DetectedAgent, InstallResult, McpEntry } from './detect.js';
export { installClaudeCode } from './claude-code.js';
export { installClaudeDesktop } from './claude-desktop.js';
export { installCursor } from './cursor.js';
export { installCodex } from './codex.js';
export { checkHealth } from './health.js';
export type { AgentHealth, HealthReport } from './health.js';
