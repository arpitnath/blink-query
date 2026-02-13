import { Blink, GIT_DERIVERS, loadFromGit, extractiveSummarize } from '../src/blink.js';
import { resolve } from 'path';

const repoPath = resolve(import.meta.dirname, '..');

async function main() {
  console.log('=== Blink Git Driver Test ===\n');

  // 1. Load files from repo
  const docs = await loadFromGit({ repoPath, include: ['src/**/*.ts'] });
  console.log(`Loaded ${docs.length} TypeScript files from git repo\n`);

  // 2. Show sample metadata
  if (docs.length > 0) {
    console.log('Sample document metadata:', JSON.stringify(docs[0].metadata, null, 2));
  }

  // 3. Ingest into Blink
  const blink = new Blink({ dbPath: ':memory:' });
  const result = await blink.ingest(docs, { ...GIT_DERIVERS, summarize: extractiveSummarize(200) });
  console.log(`\nIngested ${result.records.length} records (${result.errors.length} errors)\n`);

  // 4. List zones
  const zones = blink.zones();
  console.log('Zones:', zones.map(z => `${z.path} (${z.record_count} records)`));

  // 5. Search
  const searchResults = blink.search('adapter postgres');
  console.log(`\nSearch 'adapter postgres': ${searchResults.length} results`);
  searchResults.forEach(r => console.log(`  - ${r.path}: ${r.summary?.slice(0, 80)}...`));

  // 6. Resolve a specific record
  const resolveResult = blink.resolve('git/blink-query-git/blink');
  console.log(`\nResolve 'git/blink-query-git/blink': ${resolveResult.status}`);

  blink.close();
  console.log('\n=== Done ===');
}

main().catch(console.error);
