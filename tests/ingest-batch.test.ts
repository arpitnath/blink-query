import { describe, it, expect, vi } from 'vitest';
import { Blink } from '../src/blink.js';
import { processDocuments } from '../src/ingest.js';
import type { IngestDocument, IngestOptions, SaveInput, BlinkRecord } from '../src/types.js';

function makeDoc(i: number): IngestDocument {
  return {
    id: `doc-${i}`,
    text: `Content for document ${i}`,
    metadata: {
      file_path: `docs/doc-${i}.md`,
      file_name: `doc-${i}.md`,
      file_type: '.md',
    },
  };
}

function makeDocs(count: number): IngestDocument[] {
  return Array.from({ length: count }, (_, i) => makeDoc(i));
}

describe('processDocuments — per-batch flush', () => {
  it('saves records per batch, not all at once at the end', async () => {
    const blink = new Blink(':memory:');
    const saveManyCallCounts: number[] = [];
    const originalSaveMany = blink.saveMany.bind(blink);
    vi.spyOn(blink, 'saveMany').mockImplementation((inputs: SaveInput[]) => {
      saveManyCallCounts.push(inputs.length);
      return originalSaveMany(inputs);
    });

    const docs = makeDocs(10);
    const opts: IngestOptions = { concurrency: 5 };
    const result = await processDocuments(blink, docs, opts);

    // With 10 docs and concurrency=5, saveMany should be called twice (not once at the end)
    expect(blink.saveMany).toHaveBeenCalledTimes(2);
    expect(saveManyCallCounts).toEqual([5, 5]);
    expect(result.records).toHaveLength(10);
    expect(result.errors).toHaveLength(0);
    expect(result.total).toBe(10);
  });

  it('processes 20 docs with concurrency=5 in 4 batches', async () => {
    const blink = new Blink(':memory:');
    let saveManyCalls = 0;
    const originalSaveMany = blink.saveMany.bind(blink);
    vi.spyOn(blink, 'saveMany').mockImplementation((inputs: SaveInput[]) => {
      saveManyCalls++;
      return originalSaveMany(inputs);
    });

    const docs = makeDocs(20);
    const opts: IngestOptions = { concurrency: 5 };
    const result = await processDocuments(blink, docs, opts);

    expect(saveManyCalls).toBe(4);
    expect(result.records).toHaveLength(20);
    expect(result.total).toBe(20);
  });

  it('fires onBatchComplete callback with correct counts', async () => {
    const blink = new Blink(':memory:');
    const calls: Array<{ processed: number; total: number; batchSize: number }> = [];

    const docs = makeDocs(12);
    const opts: IngestOptions = {
      concurrency: 5,
      onBatchComplete: (info) => calls.push({ ...info }),
    };
    await processDocuments(blink, docs, opts);

    // 12 docs, concurrency=5 → batches of 5, 5, 2
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ processed: 5, total: 12, batchSize: 5 });
    expect(calls[1]).toEqual({ processed: 10, total: 12, batchSize: 5 });
    expect(calls[2]).toEqual({ processed: 12, total: 12, batchSize: 2 });
  });

  it('error in one doc does not prevent other docs in the batch from saving', async () => {
    const blink = new Blink(':memory:');

    // Mix of valid docs and one that will fail during summarization
    const docs: IngestDocument[] = [
      makeDoc(0),
      makeDoc(1),
      {
        id: 'bad-doc',
        text: 'bad content',
        metadata: { file_path: 'docs/bad.md', file_name: 'bad.md', file_type: '.md' },
      },
      makeDoc(3),
      makeDoc(4),
    ];

    const opts: IngestOptions = {
      concurrency: 5,
      summarize: (_text, metadata) => {
        if ((metadata.file_name as string) === 'bad.md') {
          throw new Error('summarization failed');
        }
        return 'summary';
      },
    };

    const result = await processDocuments(blink, docs, opts);

    // 4 docs should succeed, 1 should fail
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].error.message).toBe('summarization failed');
    expect(result.errors[0].document.id).toBe('bad-doc');
    expect(result.records).toHaveLength(4);
    expect(result.total).toBe(5);
  });

  it('tracks elapsed time', async () => {
    const blink = new Blink(':memory:');
    const docs = makeDocs(3);
    const opts: IngestOptions = { concurrency: 5 };
    const result = await processDocuments(blink, docs, opts);

    expect(typeof result.elapsed).toBe('number');
    expect(result.elapsed).toBeGreaterThanOrEqual(0);
  });

  it('returns empty records when docs array is empty', async () => {
    const blink = new Blink(':memory:');
    const result = await processDocuments(blink, [], { concurrency: 5 });

    expect(result.records).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('records are saved incrementally — each batch commits before the next starts', async () => {
    const blink = new Blink(':memory:');
    const saveManyResults: number[] = [];
    const originalSaveMany = blink.saveMany.bind(blink);
    vi.spyOn(blink, 'saveMany').mockImplementation((inputs: SaveInput[]) => {
      const saved = originalSaveMany(inputs);
      saveManyResults.push(saved.length);
      return saved;
    });

    const docs = makeDocs(10);
    const opts: IngestOptions = { concurrency: 5 };
    const result = await processDocuments(blink, docs, opts);

    // saveMany was called twice — once per batch of 5
    expect(saveManyResults).toEqual([5, 5]);
    // Final result has all 10 records
    expect(result.records).toHaveLength(10);
    // The records returned have valid IDs (proving they were actually saved)
    expect(result.records.every(r => typeof r.id === 'string' && r.id.length > 0)).toBe(true);
  });
});
