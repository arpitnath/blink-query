import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { initDB, save } from '../src/store.js';
import { resolve } from '../src/resolver.js';

let db: InstanceType<typeof Database>;

beforeEach(() => {
  db = initDB(':memory:');
});

describe('resolveCollection — cap and total count', () => {
  it('returns at most 20 items when namespace has more than 20 records', () => {
    for (let i = 1; i <= 25; i++) {
      save(db, { namespace: 'test/large', title: `Record ${i}`, type: 'SUMMARY', summary: `Summary ${i}` });
    }

    const result = resolve(db, 'test/large/');
    expect(result.status).toBe('OK');
    const content = result.record!.content as { items: unknown[] };
    expect(content.items).toHaveLength(20);
  });

  it('includes total count and truncated flag in collection content', () => {
    for (let i = 1; i <= 25; i++) {
      save(db, { namespace: 'test/count', title: `Record ${i}`, type: 'SUMMARY', summary: `Summary ${i}` });
    }

    const result = resolve(db, 'test/count/');
    expect(result.status).toBe('OK');
    const content = result.record!.content as { items: unknown[]; total: number; truncated: boolean };
    expect(content.total).toBe(25);
    expect(content.truncated).toBe(true);
  });

  it('truncated is false when namespace has 20 or fewer records', () => {
    for (let i = 1; i <= 5; i++) {
      save(db, { namespace: 'test/small', title: `Record ${i}`, type: 'SUMMARY', summary: `s${i}` });
    }

    const result = resolve(db, 'test/small/');
    const content = result.record!.content as { items: unknown[]; total: number; truncated: boolean };
    expect(content.truncated).toBe(false);
    expect(content.total).toBe(5);
    expect(content.items).toHaveLength(5);
  });

  it('sorts collection items by hit_count descending', () => {
    save(db, { namespace: 'test/hits', title: 'Record A', type: 'SUMMARY', summary: 'A' });
    save(db, { namespace: 'test/hits', title: 'Record B', type: 'SUMMARY', summary: 'B' });
    save(db, { namespace: 'test/hits', title: 'Record C', type: 'SUMMARY', summary: 'C' });

    // Increment hit counts via resolve (increments on OK resolution)
    resolve(db, 'test/hits/record-b');
    resolve(db, 'test/hits/record-b');
    resolve(db, 'test/hits/record-b');
    resolve(db, 'test/hits/record-c');
    resolve(db, 'test/hits/record-c');

    const result = resolve(db, 'test/hits/');
    expect(result.status).toBe('OK');
    const content = result.record!.content as { items: Array<{ path: string; hit_count: number }> };
    // Record B (3 hits) → C (2 hits) → A (0 hits)
    expect(content.items[0].path).toContain('record-b');
    expect(content.items[1].path).toContain('record-c');
    expect(content.items[2].path).toContain('record-a');
  });
});

describe('NXDOMAIN suggestions', () => {
  it('returns suggestions when prefix matches exist', () => {
    save(db, { namespace: 'docs', title: 'Getting Started', type: 'SUMMARY', summary: 'intro guide' });
    save(db, { namespace: 'docs', title: 'API Reference', type: 'SOURCE', summary: 'api ref' });

    const result = resolve(db, 'docs/getting');
    expect(result.status).toBe('NXDOMAIN');
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions!.length).toBeGreaterThan(0);
  });

  it('returns empty suggestions array when nothing matches', () => {
    const result = resolve(db, 'completely/nonexistent/path');
    expect(result.status).toBe('NXDOMAIN');
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions).toHaveLength(0);
  });

  it('returns suggestions from parent namespace siblings', () => {
    save(db, { namespace: 'project/docs', title: 'Overview', type: 'SUMMARY', summary: 'overview' });
    save(db, { namespace: 'project/docs', title: 'Setup Guide', type: 'SUMMARY', summary: 'setup' });
    save(db, { namespace: 'other/ns', title: 'Unrelated', type: 'SUMMARY', summary: 'unrelated' });

    // Resolve a nonexistent path in project/docs namespace
    const result = resolve(db, 'project/docs/nonexistent');
    expect(result.status).toBe('NXDOMAIN');
    expect(result.suggestions).toBeDefined();
    const paths = result.suggestions!.map(s => s.path);
    // Should find sibling records in the same namespace
    expect(paths.some(p => p.startsWith('project/docs/'))).toBe(true);
    // Should not include unrelated namespace
    expect(paths.some(p => p.startsWith('other/'))).toBe(false);
  });

  it('suggestions have correct shape with path, title, and type fields', () => {
    save(db, { namespace: 'api', title: 'User Routes', type: 'SOURCE', summary: 'routes' });

    const result = resolve(db, 'api/nonexistent');
    expect(result.status).toBe('NXDOMAIN');
    if (result.suggestions && result.suggestions.length > 0) {
      const s = result.suggestions[0];
      expect(s).toHaveProperty('path');
      expect(s).toHaveProperty('title');
      expect(s).toHaveProperty('type');
      expect(typeof s.path).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(typeof s.type).toBe('string');
    }
  });

  it('limits suggestions to 5 results', () => {
    // Save 10 records that all match the prefix
    for (let i = 1; i <= 10; i++) {
      save(db, { namespace: 'ns', title: `Match ${i}`, type: 'SUMMARY', summary: `s${i}` });
    }

    const result = resolve(db, 'ns/match');
    expect(result.status).toBe('NXDOMAIN');
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions!.length).toBeLessThanOrEqual(5);
  });
});
