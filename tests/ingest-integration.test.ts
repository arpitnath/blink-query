import { describe, it, expect, beforeEach } from 'vitest';
import { Blink } from '../src/blink.js';
import { loadDirectory, extractiveSummarize } from '../src/ingest.js';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(__dirname, 'fixtures/sample-docs');

describe('ingest integration', () => {
  let blink: Blink;

  beforeEach(() => {
    blink = new Blink({ dbPath: ':memory:' });
  });

  it('loads and ingests real files from disk', async () => {
    const docs = await loadDirectory(FIXTURES);
    expect(docs.length).toBeGreaterThanOrEqual(5);

    const result = await blink.ingest(docs, {
      summarize: extractiveSummarize(200),
      namespacePrefix: 'test-project',
    });

    expect(result.records.length).toBe(docs.length);
    expect(result.errors).toHaveLength(0);
  });

  it('respects recursive=false', async () => {
    const docs = await loadDirectory(FIXTURES, { recursive: false });
    const hasSrcFiles = docs.some(d =>
      (d.metadata.file_path as string).includes('/src/'),
    );
    expect(hasSrcFiles).toBe(false);
    expect(docs.length).toBeGreaterThanOrEqual(3); // README.md, data.csv, config.json
  });

  it('filters by extension', async () => {
    const docs = await loadDirectory(FIXTURES, { extensions: ['.md'] });
    expect(docs.length).toBeGreaterThanOrEqual(1);
    expect(docs.every(d => (d.metadata.file_type as string) === '.md')).toBe(true);
  });

  it('all ingested records have file sources', async () => {
    const docs = await loadDirectory(FIXTURES);
    const result = await blink.ingest(docs, {
      summarize: extractiveSummarize(100),
    });

    for (const record of result.records) {
      expect(record.sources.length).toBeGreaterThanOrEqual(1);
      expect(record.sources[0].type).toBe('file');
      expect(record.sources[0].file_path).toBeTruthy();
    }
  });

  it('skips binary files gracefully', async () => {
    // binary.dat exists but is not in default extensions
    const docs = await loadDirectory(FIXTURES);
    const hasBinary = docs.some(d => (d.metadata.file_name as string) === 'binary.dat');
    expect(hasBinary).toBe(false);
  });

  it('records are searchable after ingestion', async () => {
    const docs = await loadDirectory(FIXTURES);
    await blink.ingest(docs, {
      summarize: extractiveSummarize(200),
      namespacePrefix: 'project',
    });

    const results = blink.search('taskflow');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
