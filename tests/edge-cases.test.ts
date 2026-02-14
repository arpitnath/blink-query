import { describe, it, expect, beforeEach } from 'vitest';
import { initDB, save, saveMany, list, deleteRecord, move, searchByKeywords, listZones } from '../src/store.js';
import { resolve } from '../src/resolver.js';
import { executeQuery } from '../src/query-executor.js';
import type Database from 'better-sqlite3';

describe('Edge Cases', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    db = initDB(':memory:');
  });

  // Test 1: Duplicate slugs from different titles
  it('handles duplicate slugs from different titles', () => {
    const r1 = save(db, { namespace: 'test', title: 'Hello World!', summary: 'first' });
    const r2 = save(db, { namespace: 'test', title: 'Hello World?', summary: 'second' });
    // Both produce slug "hello-world" — second should get "hello-world-2"
    expect(r1.path).toBe('test/hello-world');
    expect(r2.path).toBe('test/hello-world-2');
  });

  // Test 2: ALIAS pointing to non-existent target
  it('resolves ALIAS pointing to non-existent target as NXDOMAIN', () => {
    save(db, { namespace: 'test', title: 'broken-link', type: 'ALIAS', content: { target: 'nonexistent/path' } });
    const result = resolve(db, 'test/broken-link');
    expect(result.status).toBe('NXDOMAIN');
  });

  // Test 3: ALIAS with null/undefined content
  it('rejects ALIAS with missing target', () => {
    expect(() => save(db, { namespace: 'test', title: 'bad-alias', type: 'ALIAS', content: {} })).toThrow();
    expect(() => save(db, { namespace: 'test', title: 'bad-alias2', type: 'ALIAS', content: null })).toThrow();
  });

  // Test 4: Circular ALIAS chain at boundary (5 hops)
  it('detects ALIAS_LOOP at exactly 5 hops', () => {
    // Create chain: a→b→c→d→e→a (5 hops to detect the loop)
    save(db, { namespace: 'test', title: 'a', type: 'ALIAS', content: { target: 'test/b' } });
    save(db, { namespace: 'test', title: 'b', type: 'ALIAS', content: { target: 'test/c' } });
    save(db, { namespace: 'test', title: 'c', type: 'ALIAS', content: { target: 'test/d' } });
    save(db, { namespace: 'test', title: 'd', type: 'ALIAS', content: { target: 'test/e' } });
    save(db, { namespace: 'test', title: 'e', type: 'ALIAS', content: { target: 'test/a' } });
    const result = resolve(db, 'test/a');
    expect(result.status).toBe('ALIAS_LOOP');
  });

  // Test 5: Unicode/emoji in paths and namespaces
  it('handles Unicode in namespace and title', () => {
    const record = save(db, { namespace: 'projects/日本語', title: 'テスト記事', summary: 'Unicode test' });
    expect(record.namespace).toBe('projects/日本語');
    const result = resolve(db, record.path);
    expect(result.status).toBe('OK');
  });

  // Test 6: SQL reserved keywords as namespace/title
  it('handles SQL reserved keywords safely', () => {
    const record = save(db, { namespace: 'select', title: 'DROP TABLE records', summary: 'safe' });
    expect(record.path).toBe('select/drop-table-records');
    const result = resolve(db, 'select/drop-table-records');
    expect(result.status).toBe('OK');
    expect(result.record!.summary).toBe('safe');
  });

  // Test 7: Query with invalid field names
  it('rejects query with invalid field name', () => {
    save(db, { namespace: 'test', title: 'record1', summary: 'data' });
    expect(() => executeQuery(db, "test where invalidfield = 'x'")).toThrow('Invalid query field');
  });

  // Test 8: Zone count accuracy after delete/move
  it('maintains accurate zone counts after delete and move', () => {
    save(db, { namespace: 'test', title: 'one', summary: 'a' });
    save(db, { namespace: 'test', title: 'two', summary: 'b' });
    save(db, { namespace: 'test', title: 'three', summary: 'c' });

    let zones = listZones(db);
    expect(zones.find(z => z.path === 'test')!.record_count).toBe(3);

    deleteRecord(db, 'test/one');
    zones = listZones(db);
    expect(zones.find(z => z.path === 'test')!.record_count).toBe(2);

    move(db, 'test/two', 'other/moved');
    zones = listZones(db);
    expect(zones.find(z => z.path === 'test')!.record_count).toBe(1);
    expect(zones.find(z => z.path === 'other')!.record_count).toBe(1);
  });

  // Test 9: Search with empty keywords
  it('returns empty array for empty keyword search', () => {
    save(db, { namespace: 'test', title: 'record1', summary: 'data' });
    expect(searchByKeywords(db, [])).toEqual([]);
  });

  // Test 10: Concurrent writes (upsert behavior)
  it('upserts when saving same namespace+title twice', () => {
    save(db, { namespace: 'test', title: 'same', summary: 'version 1' });
    save(db, { namespace: 'test', title: 'same', summary: 'version 2' });
    const records = list(db, 'test');
    expect(records.length).toBe(1);
    expect(records[0].summary).toBe('version 2');
  });

  // Test 11: Content size limits
  it('allows large content under 10MB', () => {
    const bigSummary = 'x'.repeat(9 * 1024 * 1024); // 9MB
    const record = save(db, { namespace: 'test', title: 'big', summary: bigSummary });
    expect(record.path).toBe('test/big');
  });

  it('rejects content over 10MB', () => {
    const hugeSummary = 'x'.repeat(11 * 1024 * 1024); // 11MB
    expect(() => save(db, { namespace: 'test', title: 'huge', content: hugeSummary })).toThrow(/exceeds maximum/);
  });

  // Test 12: Complex query with all operators
  it('handles complex query with multiple operators', () => {
    // Create test data
    for (let i = 0; i < 10; i++) {
      save(db, {
        namespace: 'test',
        title: `record-${i}`,
        type: i % 3 === 0 ? 'SUMMARY' : i % 3 === 1 ? 'META' : 'SOURCE',
        summary: `content ${i}`,
        tags: [i % 2 === 0 ? 'even' : 'odd'],
      });
    }

    // Bump hit counts for some records
    // (resolve them to increment hit_count)
    resolve(db, 'test/record-0');
    resolve(db, 'test/record-3');
    resolve(db, 'test/record-6');

    const results = executeQuery(db, "test where type in ('SUMMARY', 'META') order by updated_at desc limit 5");
    expect(results.length).toBeGreaterThan(0);
    results.forEach(r => {
      expect(['SUMMARY', 'META']).toContain(r.type);
    });
  });
});
