import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { loadFromPostgres, loadFromPostgresProgressive, introspectPostgresTable } from '../../src/adapters.js';
import { POSTGRES_DERIVERS } from '../../src/ingest.js';
import { Blink } from '../../src/blink.js';
import type { PostgresLoadConfig, PostgresProgressiveConfig, IngestDocument } from '../../src/types.js';

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

  // ─── Introspection tests ─────────────────────────────────────

  describe('introspectPostgresTable', () => {
    it('returns correct columns, types, and primary key', async () => {
      const result = await introspectPostgresTable(testDbUrl(), TEST_TABLE, 'public');

      expect(result.table).toBe(TEST_TABLE);
      expect(result.schema).toBe('public');
      expect(result.database).toBe(TEST_DB);
      expect(result.primaryKey).toBe('id');

      // Should have all 6 columns
      expect(result.columns.length).toBe(6);

      const colNames = result.columns.map(c => c.name);
      expect(colNames).toContain('id');
      expect(colNames).toContain('title');
      expect(colNames).toContain('content');
      expect(colNames).toContain('author');
      expect(colNames).toContain('category');
      expect(colNames).toContain('created_at');

      // Check data types
      const idCol = result.columns.find(c => c.name === 'id')!;
      expect(idCol.dataType).toBe('integer');
      expect(idCol.nullable).toBe(false);

      const contentCol = result.columns.find(c => c.name === 'content')!;
      expect(contentCol.dataType).toBe('text');

      const titleCol = result.columns.find(c => c.name === 'title')!;
      expect(titleCol.dataType).toBe('text');
    });

    it('returns correct row count', async () => {
      const result = await introspectPostgresTable(testDbUrl(), TEST_TABLE, 'public');

      // Row count should be 5 (may be approximate from pg_stat, so allow exact fallback)
      expect(result.rowCount).toBe(5);
    });

    it('throws for non-existent table', async () => {
      await expect(
        introspectPostgresTable(testDbUrl(), 'nonexistent_table_xyz', 'public'),
      ).rejects.toThrow(/not found|no columns/i);
    });
  });

  // ─── Progressive loading tests ───────────────────────────────

  describe('loadFromPostgresProgressive', () => {
    it('loads all 5 rows with batchSize=2', async () => {
      const config: PostgresProgressiveConfig = {
        connectionString: testDbUrl(),
        table: TEST_TABLE,
        textColumn: 'content',
        idColumn: 'id',
        batchSize: 2,
        orderBy: 'id',
      };

      const docs = await loadFromPostgresProgressive(config);

      expect(docs).toHaveLength(5);
      for (const doc of docs) {
        expect(doc).toHaveProperty('id');
        expect(doc).toHaveProperty('text');
        expect(doc.text.length).toBeGreaterThan(0);
        expect(doc.metadata.table).toBe(TEST_TABLE);
      }
    });

    it('calls onBatch with correct batch sizes', async () => {
      const batches: { docs: IngestDocument[]; idx: number; total: number }[] = [];

      const config: PostgresProgressiveConfig = {
        connectionString: testDbUrl(),
        table: TEST_TABLE,
        textColumn: 'content',
        idColumn: 'id',
        batchSize: 2,
        orderBy: 'id',
        onBatch: (docs, idx, total) => {
          batches.push({ docs: [...docs], idx, total });
        },
      };

      const docs = await loadFromPostgresProgressive(config);

      expect(docs).toHaveLength(5);
      expect(batches).toHaveLength(3); // 2, 2, 1

      expect(batches[0].docs).toHaveLength(2);
      expect(batches[0].idx).toBe(0);
      expect(batches[0].total).toBe(2);

      expect(batches[1].docs).toHaveLength(2);
      expect(batches[1].idx).toBe(1);
      expect(batches[1].total).toBe(4);

      expect(batches[2].docs).toHaveLength(1);
      expect(batches[2].idx).toBe(2);
      expect(batches[2].total).toBe(5);
    });

    it('respects offset parameter for resumption', async () => {
      const config: PostgresProgressiveConfig = {
        connectionString: testDbUrl(),
        table: TEST_TABLE,
        textColumn: 'content',
        idColumn: 'id',
        batchSize: 10,
        orderBy: 'id',
        offset: 3,
      };

      const docs = await loadFromPostgresProgressive(config);

      // Should get only the last 2 rows (rows 4 and 5, offset 3)
      expect(docs).toHaveLength(2);
    });

    it('respects maxRows parameter', async () => {
      const config: PostgresProgressiveConfig = {
        connectionString: testDbUrl(),
        table: TEST_TABLE,
        textColumn: 'content',
        idColumn: 'id',
        batchSize: 2,
        orderBy: 'id',
        maxRows: 3,
      };

      const docs = await loadFromPostgresProgressive(config);

      expect(docs).toHaveLength(3);
    });

    it('auto-detects text and id columns via introspection', async () => {
      // Do NOT specify textColumn or idColumn — let it auto-detect
      const config: PostgresProgressiveConfig = {
        connectionString: testDbUrl(),
        table: TEST_TABLE,
        batchSize: 10,
      };

      const docs = await loadFromPostgresProgressive(config);

      expect(docs).toHaveLength(5);
      // The auto-detected text column should be one of the text columns
      // and auto-detected id should be the primary key (id)
      for (const doc of docs) {
        expect(doc.text.length).toBeGreaterThan(0);
        expect(doc.metadata.row_id).toBeDefined();
      }
    });

    it('supports where clause', async () => {
      const config: PostgresProgressiveConfig = {
        connectionString: testDbUrl(),
        table: TEST_TABLE,
        textColumn: 'content',
        idColumn: 'id',
        batchSize: 10,
        orderBy: 'id',
        where: "author = 'Alice'",
      };

      const docs = await loadFromPostgresProgressive(config);

      // Alice has 2 articles
      expect(docs).toHaveLength(2);
    });

    it('produces same data as non-progressive loadFromPostgres', async () => {
      // Load with classic method
      const classicDocs = await loadFromPostgres({
        connectionString: testDbUrl(),
        query: `SELECT * FROM ${TEST_TABLE} ORDER BY id`,
        textColumn: 'content',
        idColumn: 'id',
        table: TEST_TABLE,
        schema: 'public',
      });

      // Load with progressive method
      const progressiveDocs = await loadFromPostgresProgressive({
        connectionString: testDbUrl(),
        table: TEST_TABLE,
        textColumn: 'content',
        idColumn: 'id',
        batchSize: 2,
        orderBy: 'id',
      });

      expect(progressiveDocs).toHaveLength(classicDocs.length);

      // Compare document content (same ids, same text, same metadata keys)
      for (let i = 0; i < classicDocs.length; i++) {
        expect(progressiveDocs[i].id).toBe(classicDocs[i].id);
        expect(progressiveDocs[i].text).toBe(classicDocs[i].text);
        expect(progressiveDocs[i].metadata.table).toBe(classicDocs[i].metadata.table);
        expect(progressiveDocs[i].metadata.schema).toBe(classicDocs[i].metadata.schema);
        expect(progressiveDocs[i].metadata.row_id).toBe(classicDocs[i].metadata.row_id);
      }
    });
  });

  // ─── Smart progressive ingest tests ──────────────────────────

  describe('ingestFromPostgresProgressive', () => {
    it('ingests with auto-detection and returns introspection', async () => {
      const blink = new Blink({ dbPath: ':memory:' });

      const result = await blink.ingestFromPostgresProgressive(
        {
          connectionString: testDbUrl(),
          table: TEST_TABLE,
          batchSize: 2,
          titleColumn: 'title',
        },
        { ...POSTGRES_DERIVERS },
      );

      expect(result.records).toHaveLength(5);
      expect(result.errors).toHaveLength(0);
      expect(result.introspection).toBeDefined();
      expect(result.introspection.table).toBe(TEST_TABLE);
      expect(result.introspection.primaryKey).toBe('id');
      expect(result.introspection.columns.length).toBe(6);

      // Verify records are resolvable
      const resolved = blink.resolve(`public/${TEST_TABLE}/introduction-to-postgresql`);
      expect(resolved.status).toBe('OK');
      expect(resolved.record).not.toBeNull();

      blink.close();
    });

    it('produces same records as non-progressive ingestFromPostgres', async () => {
      const blink1 = new Blink({ dbPath: ':memory:' });
      const blink2 = new Blink({ dbPath: ':memory:' });

      // Classic ingest
      const classicResult = await blink1.ingestFromPostgres(
        {
          connectionString: testDbUrl(),
          query: `SELECT * FROM ${TEST_TABLE} ORDER BY id`,
          textColumn: 'content',
          idColumn: 'id',
          titleColumn: 'title',
          table: TEST_TABLE,
          schema: 'public',
        },
        { ...POSTGRES_DERIVERS },
      );

      // Progressive ingest
      const progressiveResult = await blink2.ingestFromPostgresProgressive(
        {
          connectionString: testDbUrl(),
          table: TEST_TABLE,
          textColumn: 'content',
          idColumn: 'id',
          titleColumn: 'title',
          batchSize: 2,
          orderBy: 'id',
        },
        { ...POSTGRES_DERIVERS },
      );

      expect(progressiveResult.records).toHaveLength(classicResult.records.length);

      // Compare record titles and summaries
      const classicTitles = classicResult.records.map(r => r.title).sort();
      const progressiveTitles = progressiveResult.records.map(r => r.title).sort();
      expect(progressiveTitles).toEqual(classicTitles);

      blink1.close();
      blink2.close();
    });
  });
});
