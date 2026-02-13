import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDB, save } from '../src/store.js';
import { executeQuery } from '../src/query-executor.js';

let db: Database;

beforeEach(() => {
  db = initDB(':memory:');

  // Seed test data
  save(db, { namespace: 'discoveries/pattern', title: 'JWT Auth', summary: 'JWT with refresh tokens', tags: ['auth', 'jwt'] });
  save(db, { namespace: 'discoveries/pattern', title: 'Rate Limiting', summary: 'Token bucket algorithm', tags: ['api', 'performance'] });
  save(db, { namespace: 'discoveries/architecture', title: 'Microservices', summary: 'Service mesh patterns', tags: ['architecture'] });
  save(db, { namespace: 'me', title: 'Background', type: 'SUMMARY', summary: 'Engineer, 28 years old' });
  save(db, { namespace: 'me', title: 'Preferences', type: 'META', content: { lang: 'Go' } });
});

describe('query executor', () => {
  it('queries by namespace', () => {
    const results = executeQuery(db, 'discoveries');
    expect(results.length).toBeGreaterThanOrEqual(3);
  });

  it('filters by tag', () => {
    const results = executeQuery(db, "discoveries where tag='auth'");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('JWT Auth');
  });

  it('filters with contains', () => {
    const results = executeQuery(db, "discoveries where contains='token'");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by type', () => {
    const results = executeQuery(db, "me where type='META'");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Preferences');
  });

  it('applies ORDER BY', () => {
    const results = executeQuery(db, 'discoveries order by title');
    expect(results[0].title).toBe('JWT Auth');
  });

  it('applies LIMIT', () => {
    const results = executeQuery(db, 'discoveries limit 2');
    expect(results).toHaveLength(2);
  });

  it('returns empty for no matches', () => {
    const results = executeQuery(db, "discoveries where tag='nonexistent'");
    expect(results).toHaveLength(0);
  });

  it('combines WHERE + ORDER + LIMIT', () => {
    const results = executeQuery(db, "discoveries where tag='auth' order by title desc limit 5");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('JWT Auth');
  });

  it('rejects invalid field names', () => {
    expect(() => executeQuery(db, "test where invalid_field = 'foo'")).toThrow('Invalid query field');
  });

  // New tests for OR, IN, OFFSET
  it('executes OR query', () => {
    const results = executeQuery(db, "me where type='SUMMARY' or type='META'");
    expect(results).toHaveLength(2);
    const types = results.map(r => r.type).sort();
    expect(types).toEqual(['META', 'SUMMARY']);
  });

  it('executes IN operator with multiple values', () => {
    const results = executeQuery(db, "me where type in ('SUMMARY', 'META')");
    expect(results).toHaveLength(2);
    const types = results.map(r => r.type).sort();
    expect(types).toEqual(['META', 'SUMMARY']);
  });

  it('executes IN operator with single value', () => {
    const results = executeQuery(db, "me where type in ('META')");
    expect(results).toHaveLength(1);
    expect(results[0].type).toBe('META');
  });

  it('applies OFFSET', () => {
    // discoveries has at least 3 records
    const all = executeQuery(db, 'discoveries order by title');
    const withOffset = executeQuery(db, 'discoveries order by title offset 1');

    expect(withOffset.length).toBe(all.length - 1);
    expect(withOffset[0].title).toBe(all[1].title);
  });

  it('applies LIMIT + OFFSET together', () => {
    const all = executeQuery(db, 'discoveries order by title');
    const paginated = executeQuery(db, 'discoveries order by title limit 1 offset 1');

    expect(paginated).toHaveLength(1);
    expect(paginated[0].title).toBe(all[1].title);
  });

  it('executes complex OR + AND query', () => {
    // type='SUMMARY' or (tag='auth' and type='SOURCE')
    save(db, { namespace: 'test', title: 'Doc', type: 'SOURCE', summary: 'source doc', tags: ['auth'] });
    const results = executeQuery(db, "test where type='SUMMARY' or (tag='auth' and type='SOURCE')");
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe('Doc');
  });

  it('combines OR + IN + OFFSET', () => {
    const results = executeQuery(db, "discoveries where type in ('SUMMARY', 'SOURCE') or tag='api' limit 5 offset 0");
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
