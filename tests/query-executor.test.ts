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
});
