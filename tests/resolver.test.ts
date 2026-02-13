import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDB, save } from '../src/store.js';
import { resolve } from '../src/resolver.js';

let db: Database;

beforeEach(() => {
  db = initDB(':memory:');
});

describe('resolver', () => {
  it('resolves a known path', () => {
    save(db, { namespace: 'me', title: 'Background', summary: 'test' });
    const result = resolve(db, 'me/background');
    expect(result.status).toBe('OK');
    expect(result.record!.title).toBe('Background');
  });

  it('returns NXDOMAIN for unknown path', () => {
    const result = resolve(db, 'nonexistent/path');
    expect(result.status).toBe('NXDOMAIN');
    expect(result.record).toBeNull();
  });

  it('auto-generates COLLECTION for namespace path', () => {
    save(db, { namespace: 'me', title: 'A', summary: 'a' });
    save(db, { namespace: 'me', title: 'B', summary: 'b' });

    const result = resolve(db, 'me/');
    expect(result.status).toBe('OK');
    expect(result.record!.type).toBe('COLLECTION');
    const items = result.record!.content as Array<{ title: string }>;
    expect(items).toHaveLength(2);
  });

  it('resolves namespace without trailing slash as COLLECTION', () => {
    save(db, { namespace: 'projects/blink', title: 'Arch', summary: 'x' });
    // "projects/blink" doesn't exist as a record, but has children
    const result = resolve(db, 'projects/blink');
    // Should try as collection since no direct record exists
    expect(result.status).toBe('OK');
    expect(result.record!.type).toBe('COLLECTION');
  });

  it('follows ALIAS to target', () => {
    save(db, { namespace: 'discoveries', title: 'JWT', summary: 'jwt pattern' });
    save(db, {
      namespace: 'research',
      title: 'Auth',
      type: 'ALIAS',
      content: { target: 'discoveries/jwt' },
    });

    const result = resolve(db, 'research/auth');
    expect(result.status).toBe('OK');
    expect(result.record!.title).toBe('JWT');
    expect(result.record!.summary).toBe('jwt pattern');
  });

  it('stops ALIAS chain at 5 hops', () => {
    // Create circular aliases
    save(db, { namespace: 'a', title: 'One', type: 'ALIAS', content: { target: 'b/two' } });
    save(db, { namespace: 'b', title: 'Two', type: 'ALIAS', content: { target: 'c/three' } });
    save(db, { namespace: 'c', title: 'Three', type: 'ALIAS', content: { target: 'd/four' } });
    save(db, { namespace: 'd', title: 'Four', type: 'ALIAS', content: { target: 'e/five' } });
    save(db, { namespace: 'e', title: 'Five', type: 'ALIAS', content: { target: 'f/six' } });
    save(db, { namespace: 'f', title: 'Six', type: 'ALIAS', content: { target: 'a/one' } });

    const result = resolve(db, 'a/one');
    expect(result.status).toBe('ALIAS_LOOP');
  });

  it('returns NXDOMAIN for empty namespace', () => {
    const result = resolve(db, 'empty/');
    expect(result.status).toBe('NXDOMAIN');
  });

  it('handles ALIAS with malformed content gracefully', () => {
    // Bypass save validation by inserting directly
    db.prepare('INSERT INTO records (id, path, namespace, title, type, content, content_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'bad-alias', 'test/bad-alias', 'test', 'bad-alias', 'ALIAS', JSON.stringify({ wrong: 'field' }), 'hash', new Date().toISOString(), new Date().toISOString()
    );
    const result = resolve(db, 'test/bad-alias');
    expect(result.status).toBe('NXDOMAIN');
  });

  // New tests for STALE status
  it('returns STALE status when TTL has expired', () => {
    // Create a record with TTL of 1 second and old timestamp
    const oldTimestamp = new Date(Date.now() - 2000).toISOString(); // 2 seconds ago
    db.prepare('INSERT INTO records (id, path, namespace, title, type, summary, content, content_hash, ttl, created_at, updated_at, tags, sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'stale-record',
      'test/stale',
      'test',
      'Stale Record',
      'SUMMARY',
      'This is stale',
      null,
      'hash',
      1, // TTL = 1 second
      oldTimestamp,
      oldTimestamp,
      '[]',
      '[]'
    );

    const result = resolve(db, 'test/stale');
    expect(result.status).toBe('STALE');
    expect(result.record).not.toBeNull();
    expect(result.record!.title).toBe('Stale Record');
  });

  it('returns OK status when TTL has not expired', () => {
    // Create a record with TTL of 3600 seconds (1 hour) and recent timestamp
    save(db, { namespace: 'test', title: 'Fresh', summary: 'Fresh record', ttl: 3600 });

    const result = resolve(db, 'test/fresh');
    expect(result.status).toBe('OK');
    expect(result.record!.title).toBe('Fresh');
  });

  it('returns OK status when TTL is 0 (never expires)', () => {
    // Create a record with TTL = 0, even with old timestamp
    const oldTimestamp = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
    db.prepare('INSERT INTO records (id, path, namespace, title, type, summary, content, content_hash, ttl, created_at, updated_at, tags, sources) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'no-ttl-record',
      'test/no-ttl',
      'test',
      'No TTL',
      'SUMMARY',
      'Never expires',
      null,
      'hash',
      0, // TTL = 0 (never expires)
      oldTimestamp,
      oldTimestamp,
      '[]',
      '[]'
    );

    const result = resolve(db, 'test/no-ttl');
    expect(result.status).toBe('OK');
    expect(result.record!.title).toBe('No TTL');
  });

  it('increments hit count even for STALE records', () => {
    // Create a stale record
    const oldTimestamp = new Date(Date.now() - 2000).toISOString();
    db.prepare('INSERT INTO records (id, path, namespace, title, type, summary, content, content_hash, ttl, created_at, updated_at, tags, sources, hit_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      'stale-hit',
      'test/stale-hit',
      'test',
      'Stale Hit',
      'SUMMARY',
      'Stale but tracked',
      null,
      'hash',
      1,
      oldTimestamp,
      oldTimestamp,
      '[]',
      '[]',
      0
    );

    const result = resolve(db, 'test/stale-hit');
    expect(result.status).toBe('STALE');

    // Check hit count was incremented
    const record = db.prepare('SELECT hit_count FROM records WHERE path = ?').get('test/stale-hit') as { hit_count: number };
    expect(record.hit_count).toBe(1);
  });
});
