import { existsSync, readFileSync } from 'node:fs';
import { detectAgents } from './detect.js';
import type { AgentName } from './detect.js';

export interface AgentHealth {
  name: AgentName;
  installed: boolean;
  blinkConfigured: boolean;
  configPath: string;
}

export interface HealthReport {
  dbPath: string;
  dbExists: boolean;
  agents: AgentHealth[];
}

function hasBlinkEntry(configPath: string): boolean {
  if (!existsSync(configPath)) return false;
  try {
    const content = readFileSync(configPath, 'utf8');
    return content.includes('"blink"') || content.includes('blink-query') || content.includes('[mcp_servers.blink]');
  } catch {
    return false;
  }
}

export function checkHealth(dbPath: string): HealthReport {
  return {
    dbPath,
    dbExists: existsSync(dbPath),
    agents: detectAgents().map(agent => ({
      name: agent.name,
      installed: agent.installed,
      blinkConfigured: hasBlinkEntry(agent.configPath),
      configPath: agent.configPath,
    })),
  };
}
