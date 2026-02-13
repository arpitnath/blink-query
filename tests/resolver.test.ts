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
});
