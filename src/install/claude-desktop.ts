import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildMcpEntry, getClaudeDesktopConfigPath } from './detect.js';
import type { InstallResult } from './detect.js';

export function installClaudeDesktop(dbPath: string): InstallResult {
  const configPath = getClaudeDesktopConfigPath();
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
  const updated = { ...existing, mcpServers };

  writeFileSync(configPath, JSON.stringify(updated, null, 2) + '\n', 'utf8');

  return {
    success: true,
    agent: 'claude-desktop',
    configPath,
    message: `Wrote blink MCP config to ${configPath}.\nFully quit Claude Desktop (Cmd+Q / not just close window) then reopen.`,
    warning,
  };
}
