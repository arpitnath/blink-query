/**
 * Standalone PostgreSQL integration test for Blink-Query.
 *
 * Usage:  npx tsx test-agent/postgres-test.ts
 *
 * Requires: PostgreSQL running locally on port 5432.
 * Env override: TEST_POSTGRES_URL=postgresql://user:pass@host:port/db
 */

import { Blink, POSTGRES_DERIVERS, loadFromPostgres, extractiveSummarize } from '../src/blink.js';
import pg from 'pg';

const PG_URL = process.env.TEST_POSTGRES_URL || 'postgresql://localhost:5432/postgres';
const TEST_DB = 'blink_pg_demo';
const TEST_TABLE = 'blink_demo_articles';

function testDbUrl(): string {
  const url = new URL(PG_URL);
  url.pathname = `/${TEST_DB}`;
  return url.toString();
}

let defaultClient: pg.Client;
let testClient: pg.Client;

async function setup() {
  console.log('--- Setup: creating test database and table ---');

  defaultClient = new pg.Client({ connectionString: PG_URL });
  await defaultClient.connect();
  await defaultClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await defaultClient.query(`CREATE DATABASE ${TEST_DB}`);

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

  console.log('Seeded 5 rows into', TEST_TABLE);
}

async function cleanup() {
  console.log('\n--- Cleanup ---');
  await testClient.query(`DROP TABLE IF EXISTS ${TEST_TABLE}`);
  await testClient.end();
  await defaultClient.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await defaultClient.end();
  console.log('Dropped test table and database');
}

async function main() {
  await setup();

  try {
    // 1. Create Blink instance
    const blink = new Blink({ dbPath: ':memory:' });
    console.log('\n--- Step 1: Created Blink instance (in-memory) ---');

    // 2. Load documents from PostgreSQL
    const docs = await loadFromPostgres({
      connectionString: testDbUrl(),
      query: `SELECT * FROM ${TEST_TABLE}`,
      textColumn: 'content',
      titleColumn: 'title',
      metadataColumns: ['author', 'category'],
      table: TEST_TABLE,
    });
    console.log(`\n--- Step 2: Loaded ${docs.length} documents from PostgreSQL ---`);
    for (const doc of docs) {
      console.log(`  [${doc.id}] ${(doc.metadata.title as string) || '(no title)'} — ${doc.text.slice(0, 60)}...`);
    }

    // 3. Ingest into Blink with POSTGRES_DERIVERS + extractive summarizer
    const result = await blink.ingest(docs, {
      ...POSTGRES_DERIVERS,
      summarize: extractiveSummarize(200),
    });
    console.log(`\n--- Step 3: Ingested ${result.records.length} records (${result.errors.length} errors, ${result.elapsed}ms) ---`);

    // 4. List zones
    const zones = blink.zones();
    console.log(`\n--- Step 4: Zones (${zones.length}) ---`);
    for (const z of zones) {
      console.log(`  ${z.path} — ${z.record_count} records`);
    }

    // 5. Resolve a specific article
    const path = `public/${TEST_TABLE}/introduction-to-postgresql`;
    const resolved = blink.resolve(path);
    console.log(`\n--- Step 5: Resolve "${path}" ---`);
    console.log(`  Status: ${resolved.status}`);
    if (resolved.record) {
      console.log(`  Title: ${resolved.record.title}`);
      console.log(`  Type: ${resolved.record.type}`);
      console.log(`  Tags: ${resolved.record.tags.join(', ')}`);
      console.log(`  Summary: ${resolved.record.summary?.slice(0, 100)}...`);
    }

    // 6. Search for "optimization"
    const searchResults = blink.search('optimization');
    console.log(`\n--- Step 6: Search "optimization" → ${searchResults.length} result(s) ---`);
    for (const r of searchResults) {
      console.log(`  ${r.path} — ${r.summary?.slice(0, 80)}...`);
    }

    // 7. Summary
    console.log('\n========================================');
    console.log('PostgreSQL → Blink pipeline: SUCCESS');
    console.log(`  Documents loaded: ${docs.length}`);
    console.log(`  Records created:  ${result.records.length}`);
    console.log(`  Zones:            ${zones.length}`);
    console.log(`  Search hits:      ${searchResults.length}`);
    console.log('========================================');

    blink.close();
  } finally {
    await cleanup();
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  cleanup().catch(() => {});
  process.exit(1);
});
