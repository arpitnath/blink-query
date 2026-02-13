import { describe, it, expect, beforeEach } from 'vitest';
import { Blink } from '../src/blink.js';
import { documentToSaveInput, extractiveSummarize } from '../src/ingest.js';
import type { IngestDocument, IngestOptions } from '../src/types.js';

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

    const record = blink.get('docs/readme');
    expect(record).not.toBeNull();
    expect(record!.type).toBe('SOURCE');
    expect(record!.summary).toBe('A readme file');
    expect(record!.sources[0].type).toBe('file');
  });
});
