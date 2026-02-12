import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initDB,
  save,
  getByPath,
  list,
  deleteRecord,
  move,
  listZones,
  searchByKeywords,
  extractKeywords,
} from '../src/store.js';

let db: Database;

beforeEach(() => {
  db = initDB(':memory:');
});

describe('store', () => {
  describe('save', () => {
    it('saves a SUMMARY record', () => {
      const record = save(db, {
        namespace: 'me',
        title: 'Background',
        type: 'SUMMARY',
        summary: 'Arpit, 28, engineer',
        tags: ['personal'],
      });

      expect(record.path).toBe('me/background');
      expect(record.type).toBe('SUMMARY');
      expect(record.summary).toBe('Arpit, 28, engineer');
      expect(record.tags).toEqual(['personal']);
      expect(record.id).toHaveLength(8);
      expect(record.content_hash).toBeTruthy();
      expect(record.token_count).toBeGreaterThan(0);
    });

    it('saves a META record', () => {
      const record = save(db, {
        namespace: 'projects/orpheus',
        title: 'Conventions',
        type: 'META',
        content: { testing: 'table-driven', errors: 'wrap with %w' },
      });

      expect(record.type).toBe('META');
      expect(record.content).toEqual({ testing: 'table-driven', errors: 'wrap with %w' });
      expect(record.namespace).toBe('projects/orpheus');
    });

    it('upserts on duplicate path', () => {
      save(db, { namespace: 'me', title: 'Background', summary: 'version 1' });
      const updated = save(db, { namespace: 'me', title: 'Background', summary: 'version 2' });

      expect(updated.summary).toBe('version 2');
      const all = list(db, 'me');
      expect(all).toHaveLength(1);
    });

    it('auto-creates zone on first save', () => {
      save(db, { namespace: 'knowledge/databases', title: 'Redis', summary: 'In-memory store' });
      const zones = listZones(db);
      expect(zones.some(z => z.path === 'knowledge')).toBe(true);
    });

    it('increments zone record count', () => {
      save(db, { namespace: 'me', title: 'A', summary: 'a' });
      save(db, { namespace: 'me', title: 'B', summary: 'b' });
      const zones = listZones(db);
      const meZone = zones.find(z => z.path === 'me');
      expect(meZone?.record_count).toBe(2);
    });
  });

  describe('getByPath', () => {
    it('returns record by path', () => {
      save(db, { namespace: 'me', title: 'Background', summary: 'test' });
      const record = getByPath(db, 'me/background');
      expect(record).not.toBeNull();
      expect(record!.title).toBe('Background');
    });

    it('returns null for missing path', () => {
      expect(getByPath(db, 'nonexistent')).toBeNull();
    });
  });

  describe('list', () => {
    it('lists records in namespace', () => {
      save(db, { namespace: 'me', title: 'A', summary: 'a' });
      save(db, { namespace: 'me', title: 'B', summary: 'b' });
      save(db, { namespace: 'other', title: 'C', summary: 'c' });

      const results = list(db, 'me');
      expect(results).toHaveLength(2);
    });

    it('includes nested namespace records', () => {
      save(db, { namespace: 'projects', title: 'Overview', summary: 'x' });
      save(db, { namespace: 'projects/blink', title: 'Arch', summary: 'y' });

      const results = list(db, 'projects');
      expect(results).toHaveLength(2);
    });
  });

  describe('delete', () => {
    it('deletes a record', () => {
      save(db, { namespace: 'me', title: 'Temp', summary: 'temp' });
      expect(deleteRecord(db, 'me/temp')).toBe(true);
      expect(getByPath(db, 'me/temp')).toBeNull();
    });

    it('returns false for missing record', () => {
      expect(deleteRecord(db, 'nonexistent')).toBe(false);
    });
  });

  describe('move', () => {
    it('moves a record to new path', () => {
      save(db, { namespace: 'research', title: 'Old Topic', summary: 'content' });
      const moved = move(db, 'research/old-topic', 'archive/old-topic');
      expect(moved).not.toBeNull();
      expect(moved!.path).toBe('archive/old-topic');
      expect(getByPath(db, 'research/old-topic')).toBeNull();
    });
  });

  describe('searchByKeywords', () => {
    it('finds records by keyword', () => {
      save(db, { namespace: 'me', title: 'Background', summary: 'engineer at ToolJet', tags: ['personal'] });
      save(db, { namespace: 'me', title: 'Goals', summary: 'become architect' });

      const results = searchByKeywords(db, ['engineer']);
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Background');
    });

    it('ranks by keyword match count', () => {
      save(db, { namespace: 'k', title: 'Redis Caching', summary: 'redis is fast caching', tags: ['redis', 'caching'] });
      save(db, { namespace: 'k', title: 'Memcached', summary: 'memcached caching', tags: ['caching'] });

      const results = searchByKeywords(db, ['redis', 'caching']);
      expect(results[0].title).toBe('Redis Caching');
    });
  });
});

describe('extractKeywords', () => {
  it('extracts from title and tags', () => {
    const kw = extractKeywords({ title: 'Redis Caching Pattern', tags: ['database'], summary: null });
    expect(kw).toContain('redis');
    expect(kw).toContain('caching');
    expect(kw).toContain('pattern');
    expect(kw).toContain('database');
  });

  it('filters stop words', () => {
    const kw = extractKeywords({ title: 'The Quick Brown Fox', tags: [], summary: 'is a very fast animal' });
    expect(kw).not.toContain('the');
    expect(kw).not.toContain('is');
    expect(kw).not.toContain('very');
    expect(kw).toContain('quick');
    expect(kw).toContain('fast');
  });

  it('deduplicates', () => {
    const kw = extractKeywords({ title: 'Redis Redis', tags: ['redis'], summary: 'redis store' });
    const redisCount = kw.filter(w => w === 'redis').length;
    expect(redisCount).toBe(1);
  });
});
