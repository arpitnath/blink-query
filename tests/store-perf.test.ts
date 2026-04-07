import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { initDB, save, evictStale, listZones } from '../src/store.js';
import type Database from 'better-sqlite3';

// Helper to get a fresh in-memory database
function freshDb(): InstanceType<typeof Database> {
  return initDB(':memory:');
}

// Helper: force updated_at to a past time so eviction fires immediately
function makeStale(db: InstanceType<typeof Database>, path: string, secondsAgo: number): void {
  db.prepare(
    `UPDATE records SET updated_at = datetime('now', '-${secondsAgo} seconds') WHERE path = ?`
  ).run(path);
}

// ─── Part 1: Performance Pragmas ────────────────────────────────────────────

describe('SQLite performance pragmas', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => { db = freshDb(); });
  afterEach(() => db.close());

  it('sets synchronous to NORMAL (1)', () => {
    const result = db.pragma('synchronous') as Array<{ synchronous: number }>;
    expect(result[0].synchronous).toBe(1);
  });

  it('sets temp_store to MEMORY (2)', () => {
    const result = db.pragma('temp_store') as Array<{ temp_store: number }>;
    expect(result[0].temp_store).toBe(2);
  });
});

// ─── Part 2: skipIfUnchanged ─────────────────────────────────────────────────

describe('skipIfUnchanged', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => { db = freshDb(); });
  afterEach(() => db.close());

  it('does not update when content is unchanged and skipIfUnchanged=true', () => {
    save(db, { namespace: 'test', title: 'Alpha', summary: 'same content' });
    const path = 'test/alpha';

    // Pin updated_at to a known past timestamp
    const sentinel = '2020-01-01T00:00:00.000Z';
    db.prepare('UPDATE records SET updated_at = ? WHERE path = ?').run(sentinel, path);

    // Save again — same content, skipIfUnchanged
    save(db, { namespace: 'test', title: 'Alpha', summary: 'same content', skipIfUnchanged: true });

    const row = db.prepare('SELECT updated_at FROM records WHERE path = ?').get(path) as { updated_at: string };
    expect(row.updated_at).toBe(sentinel); // should be unchanged
  });

  it('does update when content is different even with skipIfUnchanged=true', () => {
    save(db, { namespace: 'test', title: 'Beta', summary: 'original' });
    const path = 'test/beta';

    const sentinel = '2020-01-01T00:00:00.000Z';
    db.prepare('UPDATE records SET updated_at = ? WHERE path = ?').run(sentinel, path);

    // Save again — different content, skipIfUnchanged
    save(db, { namespace: 'test', title: 'Beta', summary: 'updated', skipIfUnchanged: true });

    const row = db.prepare('SELECT updated_at, summary FROM records WHERE path = ?').get(path) as { updated_at: string; summary: string };
    expect(row.updated_at).not.toBe(sentinel); // should have changed
    expect(row.summary).toBe('updated');
  });

  it('does update when content is unchanged and skipIfUnchanged=false (default behavior)', () => {
    save(db, { namespace: 'test', title: 'Gamma', summary: 'same' });
    const path = 'test/gamma';

    const sentinel = '2020-01-01T00:00:00.000Z';
    db.prepare('UPDATE records SET updated_at = ? WHERE path = ?').run(sentinel, path);

    // skipIfUnchanged defaults to false — should always update
    save(db, { namespace: 'test', title: 'Gamma', summary: 'same' });

    const row = db.prepare('SELECT updated_at FROM records WHERE path = ?').get(path) as { updated_at: string };
    expect(row.updated_at).not.toBe(sentinel); // updated even though content is the same
  });

  it('returns the existing path on a no-op skip', () => {
    const original = save(db, { namespace: 'test', title: 'Delta', summary: 'hello' });
    const skipped = save(db, { namespace: 'test', title: 'Delta', summary: 'hello', skipIfUnchanged: true });
    expect(skipped.path).toBe(original.path);
  });
});

// ─── Part 3: TTL Eviction ────────────────────────────────────────────────────

describe('evictStale', () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => { db = freshDb(); });
  afterEach(() => db.close());

  it('deletes a stale record and returns 1', () => {
    save(db, { namespace: 'ns', title: 'Stale Record', summary: 'old', ttl: 1 });
    const path = 'ns/stale-record';

    // Force the record to look 5 seconds old (> ttl of 1 second)
    makeStale(db, path, 5);

    const count = evictStale(db);
    expect(count).toBe(1);

    const row = db.prepare('SELECT * FROM records WHERE path = ?').get(path);
    expect(row).toBeUndefined();
  });

  it('does not delete a record that has not exceeded its TTL', () => {
    save(db, { namespace: 'ns', title: 'Fresh Record', summary: 'new', ttl: 3600 });
    const path = 'ns/fresh-record';

    const count = evictStale(db);
    expect(count).toBe(0);

    const row = db.prepare('SELECT * FROM records WHERE path = ?').get(path);
    expect(row).not.toBeNull();
  });

  it('does not delete a record with ttl=0 (inserted directly — never expires)', () => {
    // Insert directly to bypass validation (ttl=0 is the "never expire" sentinel)
    const ts = new Date().toISOString();
    db.prepare(`
      INSERT INTO records (id, path, namespace, title, type, summary, content, ttl,
        created_at, updated_at, content_hash, tags, token_count, hit_count, last_hit, sources)
      VALUES ('abc12345', 'ns/eternal', 'ns', 'Eternal', 'SUMMARY', 'never dies', NULL, 0,
        ?, ?, 'fakehash', '[]', 0, 0, NULL, '[]')
    `).run(ts, ts);
    // Also index FTS
    db.prepare('INSERT INTO records_fts (record_path, title, tags, summary) VALUES (?, ?, ?, ?)').run('ns/eternal', 'Eternal', '', 'never dies');
    // Ensure zone exists so zone count operations work
    db.prepare('INSERT OR IGNORE INTO zones (path, default_ttl, record_count, created_at, last_modified) VALUES (?, 2592000, 1, ?, ?)').run('ns', ts, ts);

    // Force it to look ancient
    makeStale(db, 'ns/eternal', 9999);

    const count = evictStale(db);
    expect(count).toBe(0); // ttl=0 → excluded from eviction

    const row = db.prepare('SELECT * FROM records WHERE path = ?').get('ns/eternal');
    expect(row).not.toBeNull();
  });

  it('evicts only stale records and leaves fresh ones intact', () => {
    // Stale record
    save(db, { namespace: 'mix', title: 'Old Post', summary: 'stale', ttl: 1 });
    makeStale(db, 'mix/old-post', 5);

    // Fresh record
    save(db, { namespace: 'mix', title: 'New Post', summary: 'fresh', ttl: 3600 });

    const count = evictStale(db);
    expect(count).toBe(1);

    expect(db.prepare('SELECT * FROM records WHERE path = ?').get('mix/old-post')).toBeUndefined();
    expect(db.prepare('SELECT * FROM records WHERE path = ?').get('mix/new-post')).not.toBeUndefined();
  });

  it('decrements zone record_count after eviction', () => {
    save(db, { namespace: 'zone-test', title: 'Item One', summary: 'x', ttl: 1 });
    save(db, { namespace: 'zone-test', title: 'Item Two', summary: 'y', ttl: 3600 });
    makeStale(db, 'zone-test/item-one', 5);

    const beforeZone = listZones(db).find(z => z.path === 'zone-test')!;
    expect(beforeZone.record_count).toBe(2);

    evictStale(db);

    const afterZone = listZones(db).find(z => z.path === 'zone-test')!;
    expect(afterZone.record_count).toBe(1);
  });

  it('returns 0 when there are no records at all', () => {
    expect(evictStale(db)).toBe(0);
  });

  it('removes stale records from the FTS index', () => {
    save(db, { namespace: 'fts-test', title: 'Searchable Doc', summary: 'findme', ttl: 1 });
    const path = 'fts-test/searchable-doc';
    makeStale(db, path, 5);

    evictStale(db);

    const ftsRow = db.prepare('SELECT * FROM records_fts WHERE record_path = ?').get(path);
    expect(ftsRow).toBeUndefined();
  });
});
