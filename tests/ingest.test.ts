import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Blink } from '../src/blink.js';
import { documentToSaveInput, extractiveSummarize, loadDirectory } from '../src/ingest.js';
import type { IngestDocument, IngestOptions } from '../src/types.js';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

function mockDoc(overrides?: Partial<IngestDocument>): IngestDocument {
  return {
    id: 'test-123',
    text: 'This is the full content of the document for testing purposes.',
    metadata: {
      file_path: 'docs/api/authentication.md',
      file_name: 'authentication.md',
      file_type: '.md',
      file_size: 1234,
    },
    ...overrides,
  };
}

describe('documentToSaveInput', () => {
  it('derives namespace from file path', async () => {
    const opts: IngestOptions = { summarize: (t) => t.slice(0, 50) };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.namespace).toBe('docs/api');
  });

  it('derives title from filename without extension', async () => {
    const opts: IngestOptions = { summarize: (t) => t.slice(0, 50) };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.title).toBe('authentication');
  });

  it('defaults type to SOURCE', async () => {
    const opts: IngestOptions = { summarize: (t) => t.slice(0, 50) };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.type).toBe('SOURCE');
  });

  it('uses custom classifier', async () => {
    const opts: IngestOptions = {
      summarize: (t) => t.slice(0, 50),
      classify: () => 'SUMMARY',
    };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.type).toBe('SUMMARY');
  });

  it('uses explicit namespace string', async () => {
    const opts: IngestOptions = {
      summarize: (t) => t.slice(0, 50),
      namespace: 'my-project/docs',
    };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.namespace).toBe('my-project/docs');
  });

  it('uses namespace function', async () => {
    const opts: IngestOptions = {
      summarize: (t) => t.slice(0, 50),
      namespace: (meta) => `project/${(meta.file_type as string).replace('.', '')}`,
    };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.namespace).toBe('project/md');
  });

  it('applies namespace prefix', async () => {
    const opts: IngestOptions = {
      summarize: (t) => t.slice(0, 50),
      namespacePrefix: 'ingested',
    };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.namespace).toBe('ingested/docs/api');
  });

  it('generates tags from extension and directory', async () => {
    const opts: IngestOptions = { summarize: (t) => t.slice(0, 50) };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.tags).toContain('md');
    expect(input.tags).toContain('docs');
    expect(input.tags).toContain('api');
  });

  it('appends user-provided tags', async () => {
    const opts: IngestOptions = {
      summarize: (t) => t.slice(0, 50),
      tags: ['imported', 'v2'],
    };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.tags).toContain('imported');
    expect(input.tags).toContain('v2');
  });

  it('populates sources with file type', async () => {
    const opts: IngestOptions = { summarize: (t) => t.slice(0, 50) };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.sources).toHaveLength(1);
    expect(input.sources![0].type).toBe('file');
    expect(input.sources![0].file_path).toBe('docs/api/authentication.md');
  });

  it('calls async summarizer', async () => {
    const opts: IngestOptions = {
      summarize: async (text) => `Summary: ${text.slice(0, 20)}`,
    };
    const input = await documentToSaveInput(mockDoc(), opts);
    expect(input.summary).toMatch(/^Summary: /);
  });
});

describe('extractiveSummarize', () => {
  it('returns full text when under limit', () => {
    const fn = extractiveSummarize(500);
    expect(fn('short text', {})).toBe('short text');
  });

  it('truncates to max length with ellipsis', () => {
    const fn = extractiveSummarize(20);
    const result = fn('This is a longer text that exceeds the limit by a lot', {});
    expect(result.length).toBeLessThanOrEqual(25);
    expect(result).toContain('...');
  });
});

describe('blink.ingest()', () => {
  let blink: Blink;

  beforeEach(() => {
    blink = new Blink({ dbPath: ':memory:' });
  });

  it('ingests multiple documents', async () => {
    const docs: IngestDocument[] = [
      mockDoc({ id: '1', metadata: { file_path: 'a/one.md', file_name: 'one.md', file_type: '.md' } }),
      mockDoc({ id: '2', metadata: { file_path: 'a/two.md', file_name: 'two.md', file_type: '.md' } }),
    ];

    const result = await blink.ingest(docs, {
      summarize: (t) => t.slice(0, 100),
    });

    expect(result.records).toHaveLength(2);
    expect(result.errors).toHaveLength(0);
    expect(result.total).toBe(2);
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  it('captures errors without failing batch', async () => {
    const docs: IngestDocument[] = [
      mockDoc({ id: 'good', metadata: { file_path: 'a/good.md', file_name: 'good.md', file_type: '.md' } }),
      mockDoc({ id: 'bad', metadata: { file_path: 'a/bad.md', file_name: 'bad.md', file_type: '.md' } }),
    ];

    let callCount = 0;
    const result = await blink.ingest(docs, {
      summarize: () => {
        callCount++;
        if (callCount === 2) throw new Error('LLM timeout');
        return 'summary';
      },
    });

    expect(result.records).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error.message).toBe('LLM timeout');
  });

  it('uses default extractive summarizer when summarize not provided', async () => {
    const blink = new Blink({ dbPath: ':memory:' });
    const result = await blink.ingest(
      [mockDoc({ id: '1', metadata: { file_path: 'a/one.md', file_name: 'one.md', file_type: '.md' } })],
      {} // No summarize callback
    );
    expect(result.records).toHaveLength(1);
    expect(result.records[0].summary).toBeTruthy();
  });

  it('records are retrievable after ingestion', async () => {
    await blink.ingest(
      [mockDoc({ id: '1', metadata: { file_path: 'docs/readme.md', file_name: 'readme.md', file_type: '.md' } })],
      { summarize: () => 'A readme file' },
    );

    // README.md uses parent directory as title (so the record path is "docs/docs",
    // not "docs/readme") — see filesystemTitle's index/readme/home/about handling.
    const record = blink.get('docs/docs');
    expect(record).not.toBeNull();
    expect(record!.type).toBe('SOURCE');
    expect(record!.summary).toBe('A readme file');
    expect(record!.sources[0].type).toBe('file');
  });
});

describe('loadDirectory enhancements', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'blink-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('E1: skips files larger than maxFileSize', async () => {
    // Create a small file and a large file
    await writeFile(join(tempDir, 'small.txt'), 'Small content');
    await writeFile(join(tempDir, 'large.txt'), 'x'.repeat(2_000_000)); // 2MB

    const docs = await loadDirectory(tempDir, { maxFileSize: 1_048_576 }); // 1MB limit

    expect(docs).toHaveLength(1);
    expect(docs[0].metadata.file_name).toBe('small.txt');
  });

  it('E2: skips hidden files by default', async () => {
    await writeFile(join(tempDir, '.hidden.txt'), 'Hidden content');
    await writeFile(join(tempDir, 'visible.txt'), 'Visible content');

    const docs = await loadDirectory(tempDir);

    expect(docs).toHaveLength(1);
    expect(docs[0].metadata.file_name).toBe('visible.txt');
  });

  it('E2: includes hidden files when includeHidden is true', async () => {
    await writeFile(join(tempDir, '.hidden.txt'), 'Hidden content');
    await writeFile(join(tempDir, 'visible.txt'), 'Visible content');

    const docs = await loadDirectory(tempDir, { includeHidden: true });

    expect(docs).toHaveLength(2);
    const fileNames = docs.map(d => d.metadata.file_name);
    expect(fileNames).toContain('.hidden.txt');
    expect(fileNames).toContain('visible.txt');
  });

  it('E2: skips hidden directories by default', async () => {
    await mkdir(join(tempDir, '.hidden-dir'));
    await mkdir(join(tempDir, 'visible-dir'));
    await writeFile(join(tempDir, '.hidden-dir', 'file.txt'), 'In hidden dir');
    await writeFile(join(tempDir, 'visible-dir', 'file.txt'), 'In visible dir');

    const docs = await loadDirectory(tempDir, { recursive: true });

    expect(docs).toHaveLength(1);
    expect(docs[0].text).toBe('In visible dir');
  });

  it('E3: skips empty files', async () => {
    await writeFile(join(tempDir, 'empty.txt'), '');
    await writeFile(join(tempDir, 'whitespace.txt'), '   \n  \t  ');
    await writeFile(join(tempDir, 'content.txt'), 'Has content');

    const docs = await loadDirectory(tempDir);

    expect(docs).toHaveLength(1);
    expect(docs[0].metadata.file_name).toBe('content.txt');
  });

  it('E5: calls onProgress callback for each file', async () => {
    await writeFile(join(tempDir, 'file1.txt'), 'Content 1');
    await writeFile(join(tempDir, 'file2.txt'), 'Content 2');
    await writeFile(join(tempDir, 'file3.txt'), 'Content 3');

    const progressCalls: Array<{ current: number; file: string }> = [];
    await loadDirectory(tempDir, {
      onProgress: (info) => progressCalls.push(info),
    });

    expect(progressCalls).toHaveLength(3);
    expect(progressCalls[0].current).toBe(1);
    expect(progressCalls[1].current).toBe(2);
    expect(progressCalls[2].current).toBe(3);
    expect(progressCalls.map(p => p.file)).toContain('file1.txt');
    expect(progressCalls.map(p => p.file)).toContain('file2.txt');
    expect(progressCalls.map(p => p.file)).toContain('file3.txt');
  });

  it('E6: adds loader metadata as "basic"', async () => {
    await writeFile(join(tempDir, 'test.txt'), 'Test content');

    const docs = await loadDirectory(tempDir);

    expect(docs).toHaveLength(1);
    expect(docs[0].metadata.loader).toBe('basic');
  });

  it('E7: recognizes additional text extensions - Vue', async () => {
    await writeFile(join(tempDir, 'component.vue'), '<template>...</template>');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - Svelte', async () => {
    await writeFile(join(tempDir, 'component.svelte'), '<script>...</script>');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - SCSS', async () => {
    await writeFile(join(tempDir, 'styles.scss'), '$primary: blue;');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - GraphQL', async () => {
    await writeFile(join(tempDir, 'schema.graphql'), 'type Query { ... }');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - Protocol Buffers', async () => {
    await writeFile(join(tempDir, 'message.proto'), 'syntax = "proto3";');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - Terraform', async () => {
    await writeFile(join(tempDir, 'main.tf'), 'resource "aws_instance" {}');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - Prisma', async () => {
    await writeFile(join(tempDir, 'schema.prisma'), 'model User {}');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - Swift', async () => {
    await writeFile(join(tempDir, 'App.swift'), 'func main() {}');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - Kotlin', async () => {
    await writeFile(join(tempDir, 'Main.kt'), 'fun main() {}');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - Solidity', async () => {
    await writeFile(join(tempDir, 'Token.sol'), 'contract Token {}');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - C#', async () => {
    await writeFile(join(tempDir, 'Program.cs'), 'class Program {}');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('E7: recognizes additional text extensions - F#', async () => {
    await writeFile(join(tempDir, 'Program.fs'), 'let x = 1');
    const docs = await loadDirectory(tempDir);
    expect(docs).toHaveLength(1);
  });

  it('combines all enhancements in a realistic scenario', async () => {
    // Create various files
    await writeFile(join(tempDir, 'normal.md'), 'Normal markdown');
    await writeFile(join(tempDir, 'component.vue'), '<template>Vue</template>');
    await writeFile(join(tempDir, '.gitignore'), 'node_modules');
    await writeFile(join(tempDir, 'empty.txt'), '');
    await writeFile(join(tempDir, 'large.txt'), 'x'.repeat(2_000_000));

    const progressCalls: Array<{ current: number; file: string }> = [];
    const docs = await loadDirectory(tempDir, {
      maxFileSize: 1_048_576,
      onProgress: (info) => progressCalls.push(info),
    });

    // Should only load normal.md and component.vue (2 files)
    // Skips: .gitignore (hidden), empty.txt (empty), large.txt (too big)
    expect(docs).toHaveLength(2);
    expect(progressCalls).toHaveLength(2);
    expect(docs.every(d => d.metadata.loader === 'basic')).toBe(true);
  });
});
