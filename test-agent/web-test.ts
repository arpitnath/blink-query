/**
 * Blink Web URL Test
 *
 * Standalone script to test web URL loading and ingestion.
 * Run: npx tsx test-agent/web-test.ts
 */

import { Blink, WEB_DERIVERS, loadFromUrls, extractiveSummarize } from '../src/blink.js';

const urls = [
  'https://httpbin.org/html',
  'https://httpbin.org/json',
  'https://httpbin.org/robots.txt',
];

console.log('\n' + '='.repeat(60));
console.log('  BLINK WEB URL TEST');
console.log('  Testing: loadFromUrls + ingestFromUrls');
console.log('='.repeat(60) + '\n');

// 1. Load documents from web
console.log('Step 1: Loading documents from URLs...');
const docs = await loadFromUrls(urls);
console.log(`  Loaded ${docs.length} documents from web\n`);

// 2. Print metadata for each document
console.log('Step 2: Document metadata');
for (const doc of docs) {
  const m = doc.metadata;
  console.log(`  - ${m.url}`);
  console.log(`    domain: ${m.domain}, title: ${m.title}`);
  console.log(`    content_type: ${m.content_type}`);
  console.log(`    text preview: ${doc.text.slice(0, 80).replace(/\n/g, ' ')}...`);
  console.log();
}

// 3. Ingest into Blink
console.log('Step 3: Ingesting into Blink...');
const blink = new Blink({ dbPath: ':memory:' });
const result = await blink.ingest(docs, {
  ...WEB_DERIVERS,
  summarize: extractiveSummarize(200),
  tags: ['scraped'],
});
console.log(`  Ingested ${result.records.length} records (${result.elapsed}ms)\n`);

// 4. List zones
console.log('Step 4: Zones');
const zones = blink.zones();
for (const z of zones) {
  console.log(`  ${z.path}/ — ${z.record_count} records`);
}
console.log();

// 5. Search
console.log('Step 5: Search for "Herman Melville"');
const searchResults = blink.search('Herman Melville');
if (searchResults.length > 0) {
  console.log(`  Found ${searchResults.length} results`);
  for (const r of searchResults) {
    console.log(`  - [${r.type}] ${r.path}: ${r.summary?.slice(0, 80)}...`);
  }
} else {
  console.log('  No results found');
}
console.log();

// 6. Summary
console.log('='.repeat(60));
console.log(`  WEB TEST COMPLETE — ${result.records.length} records ingested`);
console.log('='.repeat(60) + '\n');

blink.close();
