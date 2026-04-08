import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildMcpEntry } from './detect.js';
import type { InstallResult } from './detect.js';

function blinkTomlBlock(entry: ReturnType<typeof buildMcpEntry>): string {
  const argsToml = `[${entry.args.map(a => JSON.stringify(a)).join(', ')}]`;
  return [
    '[mcp_servers.blink]',
    `command = ${JSON.stringify(entry.command)}`,
    `args = ${argsToml}`,
    '',
    '[mcp_servers.blink.env]',
    `BLINK_DB_PATH = ${JSON.stringify(entry.env.BLINK_DB_PATH)}`,
  ].join('\n');
}

// Remove any existing [mcp_servers.blink] + [mcp_servers.blink.env] blocks
function stripBlinkBlock(content: string): string {
  // Remove the blink block (everything from [mcp_servers.blink] until next top-level section or EOF)
  return content
    .replace(/\[mcp_servers\.blink(?:\.\w+)*\][^\[]*/gs, '')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
}

export function installCodex(dbPath: string): InstallResult {
  const configPath = join(homedir(), '.codex', 'config.toml');
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const entry = buildMcpEntry(dbPath);
  let existing = '';

  if (existsSync(configPath)) {
    existing = stripBlinkBlock(readFileSync(configPath, 'utf8'));
  }

  const newContent = (existing ? existing + '\n\n' : '') + blinkTomlBlock(entry) + '\n';
  writeFileSync(configPath, newContent, 'utf8');

  return {
    success: true,
    agent: 'codex',
    configPath,
    message: `Wrote blink MCP config to ${configPath}.`,
  };
}
