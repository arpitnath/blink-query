import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const CLI = join(process.cwd(), 'dist', 'index.js');

function runCli(args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}): string {
  return execSync(`node ${CLI} ${args.join(' ')}`, {
    encoding: 'utf-8',
    cwd: opts.cwd ?? process.cwd(),
    env: { ...process.env, ...(opts.env ?? {}) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('blink wiki commands (smoke tests via subprocess)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'blink-wiki-cli-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('blink wiki init', () => {
    it('initialises a wiki and creates the schema record', () => {
      const out = runCli(['--db', dbPath, '--json', 'wiki', 'init', '--ns', 'mywiki']);
      const result = JSON.parse(out);
      expect(result.status).toBe('ok');
      expect(result.namespace).toBe('mywiki');
    });

    it('uses default namespace "wiki" when not specified', () => {
      const out = runCli(['--db', dbPath, '--json', 'wiki', 'init']);
      const result = JSON.parse(out);
      expect(result.namespace).toBe('wiki');
    });

    it('persists schema and zone records that can be resolved', () => {
      runCli(['--db', dbPath, 'wiki', 'init', '--ns', 'mywiki']);

      const schema = runCli(['--db', dbPath, '--json', 'resolve', 'mywiki/wiki-schema']);
      const parsed = JSON.parse(schema);
      expect(parsed.status).toBe('OK');
      expect(parsed.record.type).toBe('META');
      expect(parsed.record.content.version).toBe('2.0.0');
    });

    it('creates zones for concepts, references, and pages', () => {
      runCli(['--db', dbPath, 'wiki', 'init', '--ns', 'mywiki']);

      for (const zone of ['concepts', 'references', 'pages']) {
        const out = runCli(['--db', dbPath, '--json', 'resolve', `mywiki/${zone}/${zone}`]);
        const parsed = JSON.parse(out);
        expect(parsed.status).toBe('OK');
      }
    });
  });

  describe('blink wiki ingest', () => {
    it('ingests markdown files from a directory', () => {
      runCli(['--db', dbPath, 'wiki', 'init', '--ns', 'mywiki']);

      const sourcesDir = join(tmpDir, 'sources');
      mkdirSync(sourcesDir, { recursive: true });
      writeFileSync(join(sourcesDir, 'foo.md'), '# Foo\n\nFoo content here.');
      writeFileSync(join(sourcesDir, 'bar.md'), '# Bar\n\nBar content here.');

      const out = runCli([
        '--db', dbPath,
        '--json',
        'wiki', 'ingest', sourcesDir,
        '--ns', 'mywiki/pages',
      ]);

      const result = JSON.parse(out);
      expect(result.records).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
    });

    it('reports zero records for an empty directory', () => {
      const emptyDir = join(tmpDir, 'empty');
      mkdirSync(emptyDir, { recursive: true });

      const out = runCli([
        '--db', dbPath,
        'wiki', 'ingest', emptyDir,
      ]);

      expect(out).toContain('No supported files found');
    });
  });

  describe('blink wiki lint', () => {
    it('reports clean lint when there are no broken aliases', () => {
      runCli(['--db', dbPath, 'wiki', 'init', '--ns', 'mywiki']);

      const out = runCli(['--db', dbPath, '--json', 'wiki', 'lint', '--ns', 'mywiki']);
      const result = JSON.parse(out);
      expect(result.namespace).toBe('mywiki');
      expect(result.broken).toEqual([]);
    });

    it('detects broken alias targets', () => {
      runCli(['--db', dbPath, 'wiki', 'init', '--ns', 'mywiki']);
      runCli([
        '--db', dbPath,
        'save',
        '--ns', 'mywiki/concepts',
        '--title', 'broken-alias',
        '--type', 'ALIAS',
        '\'{"target":"mywiki/does-not-exist"}\'',
      ]);

      let exitCode = 0;
      let out = '';
      try {
        out = runCli(['--db', dbPath, '--json', 'wiki', 'lint', '--ns', 'mywiki']);
      } catch (err) {
        const e = err as { status?: number; stdout?: Buffer };
        exitCode = e.status ?? 1;
        out = e.stdout?.toString() ?? '';
      }

      const result = JSON.parse(out);
      expect(result.broken.length).toBeGreaterThan(0);
      expect(exitCode).not.toBe(0);
    });
  });

  describe('blink doctor', () => {
    it('produces a JSON health report', () => {
      const out = runCli(['--db', dbPath, '--json', 'doctor']);
      const report = JSON.parse(out);
      expect(report).toHaveProperty('dbPath');
      expect(report).toHaveProperty('agents');
      expect(Array.isArray(report.agents)).toBe(true);
    });
  });
});
