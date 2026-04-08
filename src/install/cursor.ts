import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildMcpEntry } from './detect.js';
import type { InstallResult } from './detect.js';

export function installCursor(dbPath: string): InstallResult {
  const configPath = join(homedir(), '.cursor', 'mcp.json');
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  let existing: Record<string, unknown> = {};
  let warning: string | undefined;

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8');
    try {
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const backupPath = `${configPath}.bak`;
      renameSync(configPath, backupPath);
      warning = `Could not parse existing config — backed up to ${backupPath}`;
    }
  }

  const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {};
  mcpServers['blink'] = buildMcpEntry(dbPath);
  existing['mcpServers'] = mcpServers;

  writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

  return {
    success: true,
    agent: 'cursor',
    configPath,
    message: `Wrote blink MCP config to ${configPath}. Restart Cursor to apply.`,
    warning,
  };
}
