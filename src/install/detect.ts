import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type AgentName = 'claude-desktop' | 'claude-code' | 'cursor' | 'codex';

export interface DetectedAgent {
  name: AgentName;
  configPath: string;
  installed: boolean;
}

export interface McpEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface InstallResult {
  success: boolean;
  agent: AgentName;
  configPath: string;
  message: string;
  warning?: string;
}

export function defaultDbPath(): string {
  return join(homedir(), '.blink', 'blink.db');
}

export function getClaudeDesktopConfigPath(): string {
  const home = homedir();
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  }
  if (process.platform === 'linux') {
    return join(home, '.config', 'Claude', 'claude_desktop_config.json');
  }
  // Windows
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  return join(appData, 'Claude', 'claude_desktop_config.json');
}

export function detectNvm(): { detected: boolean; nodePath: string } {
  const nvmDir = process.env.NVM_DIR ?? join(homedir(), '.nvm');
  if (!existsSync(nvmDir)) {
    return { detected: false, nodePath: '' };
  }
  return { detected: true, nodePath: process.execPath };
}

export function isCommandAvailable(cmd: string): boolean {
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`, {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
}

export function buildMcpEntry(dbPath: string): McpEntry {
  const nvm = detectNvm();
  if (nvm.detected) {
    return {
      command: nvm.nodePath,
      args: [process.argv[1]!, 'mcp'],
      env: { BLINK_DB_PATH: dbPath },
    };
  }
  if (process.platform === 'win32') {
    return {
      command: 'cmd',
      args: ['/c', 'npx', '-y', 'blink-query', 'mcp'],
      env: { BLINK_DB_PATH: dbPath },
    };
  }
  return {
    command: 'npx',
    args: ['-y', 'blink-query', 'mcp'],
    env: { BLINK_DB_PATH: dbPath },
  };
}

export function detectAgents(): DetectedAgent[] {
  const home = homedir();
  return [
    {
      name: 'claude-desktop',
      configPath: getClaudeDesktopConfigPath(),
      installed: existsSync(join(home, 'Library', 'Application Support', 'Claude'))
        || existsSync(join(home, '.config', 'Claude'))
        || existsSync(join(process.env.APPDATA ?? '', 'Claude')),
    },
    {
      name: 'claude-code',
      configPath: join(home, '.claude.json'),
      installed: isCommandAvailable('claude'),
    },
    {
      name: 'cursor',
      configPath: join(home, '.cursor', 'mcp.json'),
      installed: existsSync(join(home, '.cursor')),
    },
    {
      name: 'codex',
      configPath: join(home, '.codex', 'config.toml'),
      installed: existsSync(join(home, '.codex')),
    },
  ];
}
