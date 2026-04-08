/**
 * llm-wiki example: runs a handful of representative queries against the
 * ingested corpus. Demonstrates resolve / search / list / ALIAS following.
 *
 * Run (after `npm run ingest`):
 *   npm run query
 */

import { resolve } from 'path';
import { Blink } from 'blink-query';

const CORPUS_DIR = resolve(import.meta.dirname ?? __dirname);
const BLINK_DB = resolve(CORPUS_DIR, 'data', 'blink.db');

function header(title: string): void {
  console.log('\n──────────────────────────────────────────────────────────────');
  console.log(`  ${title}`);
  console.log('──────────────────────────────────────────────────────────────');
}

async function main() {
  const blink = new Blink({ dbPath: BLINK_DB });

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  llm-wiki query examples');
  console.log('══════════════════════════════════════════════════════════════');

  // 1. Direct path resolution — O(1) lookup
  header('1. blink.resolve("topics/mcp-overview")  — direct path lookup');
  const overview = blink.resolve('topics/mcp-overview');
  if (overview.status === 'OK' && overview.record) {
    console.log(`  type:     ${overview.record.type}`);
    console.log(`  title:    ${overview.record.title}`);
    console.log(`  summary:  ${(overview.record.summary ?? '').slice(0, 120)}...`);
  } else {
    console.log(`  status: ${overview.status}`);
  }

  // 2. Keyword search across the corpus
  header('2. blink.search("MCP transport stdio")  — BM25 keyword search');
  const hits = blink.search('MCP transport stdio', { limit: 5 });
  for (const r of hits) {
    console.log(`  [${r.type.padEnd(7)}] ${r.path}`);
  }

  // 3. Browse a namespace
  header('3. blink.list("entity/")  — browse all entity pages');
  const entities = blink.list('entity', 'recent', { limit: 10 });
  for (const r of entities) {
    console.log(`  [${r.type.padEnd(7)}] ${r.path}  —  ${r.title}`);
  }

  // 4. Browse sources
  header('4. blink.list("sources/")  — first 5 source documents');
  const sources = blink.list('sources', 'recent', { limit: 5 });
  for (const r of sources) {
    console.log(`  [${r.type.padEnd(7)}] ${r.path}`);
  }

  // 5. Resolve a COLLECTION — auto-generated index of a namespace
  header('5. blink.resolve("topics/")  — COLLECTION (auto-generated index)');
  const topicsColl = blink.resolve('topics/');
  if (topicsColl.status === 'OK' && topicsColl.record) {
    console.log(`  type:     ${topicsColl.record.type}`);
    const children = topicsColl.record.content as Array<{ path: string; title: string; type: string }>;
    if (Array.isArray(children)) {
      console.log(`  children: ${children.length}`);
      for (const c of children) {
        console.log(`    [${c.type.padEnd(7)}] ${c.path}  —  ${c.title}`);
      }
    }
  }

  // 6. Follow an ALIAS (from wikilink extraction)
  header('6. ALIAS records from [[wikilink]] extraction');
  const topicAliases = blink.list('topics/mcp-overview/aliases', 'recent', { limit: 10 });
  if (topicAliases.length === 0) {
    console.log('  (none — run `npm run ingest` to populate)');
  } else {
    for (const alias of topicAliases) {
      const target = (alias.content as { target?: string } | null)?.target;
      console.log(`  [ALIAS] ${alias.path}  →  ${target ?? '(no target)'}`);
    }
  }

  // 7. Resolve through an ALIAS chain
  if (topicAliases.length > 0) {
    header(`7. blink.resolve("${topicAliases[0].path}")  — follows the ALIAS`);
    const resolved = blink.resolve(topicAliases[0].path);
    if (resolved.status === 'OK' && resolved.record) {
      console.log(`  type:     ${resolved.record.type}`);
      console.log(`  path:     ${resolved.record.path}`);
      console.log(`  title:    ${resolved.record.title}`);
    }
  }

  // 8. Structured query via DSL
  header('8. blink.query("entity where tag = \'protocol\'")  — query DSL');
  try {
    const results = blink.query("entity where tag = 'protocol'");
    for (const r of results) {
      console.log(`  [${r.type.padEnd(7)}] ${r.path}  —  ${r.title}`);
    }
    if (results.length === 0) console.log('  (no matches)');
  } catch (err) {
    console.log(`  query error: ${err instanceof Error ? err.message : String(err)}`);
  }

  console.log();
  blink.close();
}

main().catch(err => {
  console.error('Query failed:', err);
  process.exit(1);
});
