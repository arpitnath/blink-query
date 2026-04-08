import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  initDB,
  save,
  saveMany,
  getByPath,
  list,
  deleteRecord,
  move,
  listZones,
  searchByKeywords,
  slug,
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
      expect(record.id).toHaveLength(16);
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

    it('handles slug collisions with different titles', () => {
      save(db, { namespace: 'test', title: 'Foo!' });
      save(db, { namespace: 'test', title: 'foo?' });
      const records = list(db, 'test');
      expect(records.length).toBe(2);
      expect(records.map(r => r.path).sort()).toEqual(['test/foo', 'test/foo-2'].sort());
    });

    it('handles emoji-only titles with fallback slug', () => {
      const record = save(db, { namespace: 'test', title: '🎉🎊!!!' });
      expect(record.path).toMatch(/^test\/record-/);
    });

    it('rejects ALIAS without valid target', () => {
      expect(() => save(db, { namespace: 'test', title: 'bad-alias', type: 'ALIAS', content: { wrong: 'field' } })).toThrow('ALIAS records require content');
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

    it('supports limit parameter', () => {
      save(db, { namespace: 'items', title: 'Item 1', summary: 'first' });
      save(db, { namespace: 'items', title: 'Item 2', summary: 'second' });
      save(db, { namespace: 'items', title: 'Item 3', summary: 'third' });

      const results = list(db, 'items', 'recent', 2);
      expect(results).toHaveLength(2);
    });

    it('supports offset parameter', () => {
      save(db, { namespace: 'items', title: 'Item 1', summary: 'first' });
      save(db, { namespace: 'items', title: 'Item 2', summary: 'second' });
      save(db, { namespace: 'items', title: 'Item 3', summary: 'third' });

      const results = list(db, 'items', 'title', undefined, 1);
      expect(results).toHaveLength(2);
      expect(results[0].title).toBe('Item 2');
    });

    it('supports pagination with limit and offset', () => {
      for (let i = 1; i <= 10; i++) {
        save(db, { namespace: 'pages', title: `Page ${String(i).padStart(2, '0')}`, summary: `content ${i}` });
      }

      // Get first page (items 01-03)
      const page1 = list(db, 'pages', 'title', 3, 0);
      expect(page1).toHaveLength(3);
      expect(page1[0].title).toBe('Page 01');

      // Get second page (items 04-06)
      const page2 = list(db, 'pages', 'title', 3, 3);
      expect(page2).toHaveLength(3);
      expect(page2[0].title).toBe('Page 04');

      // Get third page (items 07-09)
      const page3 = list(db, 'pages', 'title', 3, 6);
      expect(page3).toHaveLength(3);
      expect(page3[0].title).toBe('Page 07');
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

    it('supports offset parameter', () => {
      save(db, { namespace: 'docs', title: 'Doc 1', summary: 'testing guide' });
      save(db, { namespace: 'docs', title: 'Doc 2', summary: 'testing best practices' });
      save(db, { namespace: 'docs', title: 'Doc 3', summary: 'testing strategies' });

      const allResults = searchByKeywords(db, ['testing'], undefined, 10, 0);
      expect(allResults).toHaveLength(3);

      const offsetResults = searchByKeywords(db, ['testing'], undefined, 10, 1);
      expect(offsetResults).toHaveLength(2);
      expect(offsetResults[0].path).toBe(allResults[1].path);
    });
  });

  describe('saveMany', () => {
    it('saves multiple records in a single transaction', () => {
      const inputs = [
        { namespace: 'bulk', title: 'Record 1', summary: 'first' },
        { namespace: 'bulk', title: 'Record 2', summary: 'second' },
        { namespace: 'bulk', title: 'Record 3', summary: 'third' },
      ];

      const saved = saveMany(db, inputs);
      expect(saved).toHaveLength(3);
      expect(saved[0].title).toBe('Record 1');
      expect(saved[1].title).toBe('Record 2');
      expect(saved[2].title).toBe('Record 3');

      const all = list(db, 'bulk');
      expect(all).toHaveLength(3);
    });

    it('rolls back all saves on error', () => {
      const inputs = [
        { namespace: 'bulk', title: 'Valid 1', summary: 'ok' },
        { namespace: 'bulk', title: 'Valid 2', summary: 'ok' },
        { namespace: '', title: 'Invalid', summary: 'bad' }, // Empty namespace should fail
      ];

      expect(() => saveMany(db, inputs)).toThrow();

      // None of the records should be saved
      const all = list(db, 'bulk');
      expect(all).toHaveLength(0);
    });
  });
});

describe('slug', () => {
  it('produces expected path segments', () => {
    expect(slug('Hello World')).toBe('hello-world');
    expect(slug('API Reference')).toBe('api-reference');
  });
});

describe('FTS5 features', () => {
  it('supports porter stemming', () => {
    save(db, { namespace: 'test', title: 'Running tests', summary: 'test runner' });
    // Search for "run" should find "running" and "runner" via porter stemming
    const results = searchByKeywords(db, ['run']);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Running tests');
  });

  it('handles empty keyword array', () => {
    const results = searchByKeywords(db, []);
    expect(results).toEqual([]);
  });

  it('handles unicode text', () => {
    save(db, { namespace: 'test', title: 'Café résumé', summary: 'unicode test' });
    const results = searchByKeywords(db, ['café']);
    expect(results).toHaveLength(1);
  });
});
