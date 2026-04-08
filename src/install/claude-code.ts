import { execSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildMcpEntry } from './detect.js';
import type { InstallResult } from './detect.js';

export function installClaudeCode(dbPath: string): InstallResult {
  const configPath = join(homedir(), '.claude.json');
  const entry = buildMcpEntry(dbPath);

  // Try the claude CLI first
  try {
    const entryJson = JSON.stringify(entry);
    execSync(`claude mcp add-json blink --scope user '${entryJson}'`, {
      stdio: 'pipe',
    });
    return {
      success: true,
      agent: 'claude-code',
      configPath,
      message: 'Installed blink MCP server via `claude mcp add-json`.',
    };
  } catch {
    // Fall through to direct file edit
  }

  // Direct ~/.claude.json edit
  let existing: Record<string, unknown> = {};
  let warning: string | undefined;

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, 'utf8');
    try {
      existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      const backupPath = `${configPath}.bak`;
      renameSync(configPath, backupPath);
      warning = `Could not parse ${configPath} — backed up to ${backupPath}`;
    }
  }

  const mcpServers = (existing.mcpServers as Record<string, unknown>) ?? {};
  mcpServers['blink'] = entry;
  existing['mcpServers'] = mcpServers;

  writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n', 'utf8');

  return {
    success: true,
    agent: 'claude-code',
    configPath,
    message: `Wrote blink MCP config to ${configPath}.`,
    warning,
  };
}
