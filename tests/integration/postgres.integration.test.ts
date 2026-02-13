import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { loadFromPostgres } from '../../src/adapters.js';
import { POSTGRES_DERIVERS } from '../../src/ingest.js';
import { Blink } from '../../src/blink.js';
import type { PostgresLoadConfig } from '../../src/types.js';

// ─── Config ──────────────────────────────────────────────────

const PG_URL = process.env.TEST_POSTGRES_URL || 'postgresql://localhost:5432/postgres';
const TEST_DB = 'blink_test';
const TEST_TABLE = 'blink_test_articles';

function testDbUrl(): string {
  const url = new URL(PG_URL);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

// ─── PG availability check (top-level await so skipIf works) ─

let pgAvailable = false;
try {
  const client = new pg.Client({ connectionString: PG_URL });
  await client.connect();
  await client.query('SELECT 1');
  await client.end();
  pgAvailable = true;
} catch {
  pgAvailable = false;
}

// ─── Tests ───────────────────────────────────────────────────

describe.skipIf(!pgAvailable)('PostgreSQL integration', () => {
  let defaultClient: pg.Client;
  let testClient: pg.Client;

  beforeAll(async () => {
    // Connect to default DB, create test database
    defaultClient = new pg.Client({ connectionString: PG_URL });
    await defaultClient.connect();

    // Drop if leftover from a previous failed run
    await defaultClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await defaultClient.query(`CREATE DATABASE ${TEST_DB}`);

    // Connect to test database, create table, seed data
    testClient = new pg.Client({ connectionString: testDbUrl() });
    await testClient.connect();

    await testClient.query(`
      CREATE TABLE ${TEST_TABLE} (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author TEXT,
        category TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await testClient.query(`
      INSERT INTO ${TEST_TABLE} (title, content, author, category) VALUES
        ('Introduction to PostgreSQL', 'PostgreSQL is a powerful open-source relational database management system that supports both SQL and JSON querying.', 'Alice', 'database'),
        ('Query Optimization Tips', 'Use EXPLAIN ANALYZE to understand query plans and optimize performance for complex SQL queries.', 'Bob', 'performance'),
        ('Indexing Strategies', 'B-tree indexes are the default in PostgreSQL. Consider GIN for full-text search and GiST for geometric data.', 'Alice', 'database'),
        ('Connection Pooling Best Practices', 'Use PgBouncer or built-in connection pooling for better resource usage in high-traffic applications.', 'Charlie', 'operations'),
        ('JSON Support in PostgreSQL', 'JSONB columns support indexing and complex querying patterns for semi-structured data storage.', 'Bob', 'features')
    `);
  });

  afterAll(async () => {
    // Drop test table, close test connection
    await testClient.query(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
    await testClient.end();

    // Drop test database from default connection
    await defaultClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
    await defaultClient.end();
  });
  function baseConfig(): PostgresLoadConfig {
    return {
      connectionString: testDbUrl(),
      query: `SELECT * FROM ${TEST_TABLE}`,
      textColumn: 'content',
      table: TEST_TABLE,
    };
  }

  it('loads all rows as IngestDocuments', async () => {
    const docs = await loadFromPostgres(baseConfig());

    expect(docs).toHaveLength(5);
    for (const doc of docs) {
      expect(doc).toHaveProperty('id');
      expect(doc).toHaveProperty('text');
      expect(doc).toHaveProperty('metadata');
      expect(typeof doc.id).toBe('string');
      expect(doc.text.length).toBeGreaterThan(0);
    }
  });

  it('populates metadata with table, schema, database, and sanitized connection string', async () => {
    const docs = await loadFromPostgres(baseConfig());
    const first = docs[0];

    expect(first.metadata.table).toBe(TEST_TABLE);
    expect(first.metadata.schema).toBe('public');
    expect(first.metadata.database).toBe(TEST_DB);
    expect(typeof first.metadata.row_id).toBe('string');

    // Connection string should be sanitized (no raw password)
    const connStr = first.metadata.connection_string as string;
    expect(connStr).not.toContain('secretpassword');
  });

  it('maps custom title and metadata columns', async () => {
    const docs = await loadFromPostgres({
      ...baseConfig(),
      titleColumn: 'title',
      metadataColumns: ['author', 'category'],
    });

    const first = docs[0];
    expect(first.metadata.title).toBe('Introduction to PostgreSQL');
    expect(first.metadata.author).toBe('Alice');
    expect(first.metadata.category).toBe('database');
  });

  it('returns empty array for query with no results', async () => {
    const docs = await loadFromPostgres({
      ...baseConfig(),
      query: `SELECT * FROM ${TEST_TABLE} WHERE id = -1`,
    });

    expect(docs).toEqual([]);
  });

  it('ingests from postgres and resolves a record', async () => {
    const blink = new Blink({ dbPath: ':memory:' });

    const config: PostgresLoadConfig = {
      ...baseConfig(),
      titleColumn: 'title',
    };

    const result = await blink.ingestFromPostgres(config, { ...POSTGRES_DERIVERS });

    expect(result.records.length).toBe(5);
    expect(result.errors).toHaveLength(0);

    // Resolve a specific article — namespace is "public/blink_test_articles"
    const resolved = blink.resolve(`public/${TEST_TABLE}/introduction-to-postgresql`);
    expect(resolved.status).toBe('OK');
    expect(resolved.record).not.toBeNull();
    expect(resolved.record!.title).toBe('Introduction to PostgreSQL');

    blink.close();
  });

  it('supports search after ingest', async () => {
    const blink = new Blink({ dbPath: ':memory:' });

    await blink.ingestFromPostgres(
      { ...baseConfig(), titleColumn: 'title' },
      { ...POSTGRES_DERIVERS },
    );

    const results = blink.search('optimization');
    expect(results.length).toBeGreaterThanOrEqual(1);

    const summaries = results.map(r => r.summary?.toLowerCase() || '');
    expect(summaries.some(s => s.includes('optim'))).toBe(true);

    blink.close();
  });

  it('rejects with error for bad connection string', async () => {
    const config: PostgresLoadConfig = {
      connectionString: 'postgresql://localhost:59999/nope',
      query: 'SELECT 1',
      textColumn: 'content',
    };

    await expect(loadFromPostgres(config)).rejects.toThrow();
  });
});
