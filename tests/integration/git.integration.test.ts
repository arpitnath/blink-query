import { describe, it, expect, beforeAll } from 'vitest';
import { loadFromGit } from '../../src/adapters.js';
import { Blink, GIT_DERIVERS, extractiveSummarize } from '../../src/blink.js';
import type { GitLoadConfig } from '../../src/types.js';
import { resolve, basename } from 'path';
import { execSync } from 'child_process';

const REPO_PATH = resolve(__dirname, '../..');
const REPO_NAME = basename(REPO_PATH);

describe('loadFromGit', () => {
  it('loads files from a git repository', async () => {
    const docs = await loadFromGit({ repoPath: REPO_PATH });
    expect(docs.length).toBeGreaterThan(0);
    const paths = docs.map(d => d.metadata.file_path);
    expect(paths).toContain('src/blink.ts');
  });

  it('populates metadata correctly', async () => {
    const docs = await loadFromGit({ repoPath: REPO_PATH });
    const doc = docs[0];
    expect(doc.metadata.repo).toBe(REPO_PATH);
    expect(doc.metadata.ref).toBe('HEAD');
    expect(doc.metadata.file_path).toBeTruthy();
    expect(doc.metadata.file_name).toBeTruthy();
    expect(doc.metadata.file_type).toBeTruthy();
    expect(doc.metadata.commit_sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('excludes default patterns (node_modules, .git, dist)', async () => {
    const docs = await loadFromGit({ repoPath: REPO_PATH });
    const paths = docs.map(d => d.metadata.file_path as string);
    expect(paths.every(p => !p.startsWith('node_modules/'))).toBe(true);
    expect(paths.every(p => !p.startsWith('.git/'))).toBe(true);
    expect(paths.every(p => !p.startsWith('dist/'))).toBe(true);
  });

  it('filters with include glob (non-recursive)', async () => {
    const docs = await loadFromGit({ repoPath: REPO_PATH, include: ['src/*.ts'] });
    expect(docs.length).toBeGreaterThan(0);
    const paths = docs.map(d => d.metadata.file_path as string);
    // All should be directly in src/, not in subdirectories
    expect(paths.every(p => p.startsWith('src/') && !p.slice(4).includes('/'))).toBe(true);
  });

  it('respects maxFileSize', async () => {
    const smallDocs = await loadFromGit({ repoPath: REPO_PATH, maxFileSize: 500 });
    const allDocs = await loadFromGit({ repoPath: REPO_PATH });
    expect(smallDocs.length).toBeLessThan(allDocs.length);
  });

  it('loads files from a specific ref', async () => {
    const firstCommit = execSync('git rev-list --max-parents=0 HEAD', { cwd: REPO_PATH }).toString().trim();
    const docs = await loadFromGit({ repoPath: REPO_PATH, ref: firstCommit });
    const headDocs = await loadFromGit({ repoPath: REPO_PATH });
    expect(docs.length).toBeLessThan(headDocs.length);
  });

  it('rejects non-git directories', async () => {
    await expect(loadFromGit({ repoPath: '/tmp' })).rejects.toThrow(/not a git repository/i);
  });
});

describe('ingestFromGit (E2E)', () => {
  let blink: Blink;

  beforeAll(async () => {
    blink = new Blink({ dbPath: ':memory:' });
    await blink.ingestFromGit(
      { repoPath: REPO_PATH, include: ['src/*.ts'] },
      { ...GIT_DERIVERS, summarize: extractiveSummarize(200) },
    );
  });

  it('creates records accessible via resolve', () => {
    const result = blink.resolve(`git/${REPO_NAME}/`);
    expect(result.status).toBe('OK');
    expect(result.record).not.toBeNull();
  });

  it('finds records via search', () => {
    const results = blink.search('resolver');
    expect(results.length).toBeGreaterThan(0);
  });
});
