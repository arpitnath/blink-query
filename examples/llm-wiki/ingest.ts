/**
 * llm-wiki example: ingest the curated corpus into blink.db
 *
 * Uses WIKI_DERIVERS to classify each markdown file based on its frontmatter
 * and path:
 *   - sources/*.md with source_url frontmatter → SOURCE
 *   - entity/*.md with type: META → META (structured entity pages)
 *   - topics/*.md → SUMMARY (synthesized wiki pages)
 *   - log/<date>/*.md with type: META → META (append-only log entries)
 *
 * Wikilinks ([[target]] in summary text) are extracted into ALIAS records at
 * <record.path>/aliases/<target> pointing to the resolved target path.
 *
 * Run:
 *   npm run ingest
 */

import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { Blink, WIKI_DERIVERS, extractiveSummarize } from 'blink-query';

const CORPUS_DIR = resolve(import.meta.dirname ?? __dirname);
const DATA_DIR = resolve(CORPUS_DIR, 'data');
const BLINK_DB = resolve(DATA_DIR, 'blink.db');

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main() {
  const t0 = Date.now();

  mkdirSync(DATA_DIR, { recursive: true });

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  llm-wiki ingest');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Corpus: ${CORPUS_DIR}`);
  console.log(`  DB:     ${BLINK_DB}`);
  console.log('──────────────────────────────────────────────────────────────');

  const blink = new Blink({ dbPath: BLINK_DB });

  // Walk the corpus — sources/, entity/, topics/, log/ — as one ingest pass.
  // WIKI_DERIVERS' namespace function inspects file_path to route each file
  // into the right namespace (sources, entity/<slug>, topics, log/<date>).
  const result = await blink.ingestDirectory(
    CORPUS_DIR,
    {
      ...WIKI_DERIVERS,
      summarize: extractiveSummarize(800),
      extractLinks: true,
    },
    { recursive: true, extensions: ['.md'] },
  );

  const elapsed = Date.now() - t0;

  // Group by type for reporting
  const byType: Record<string, number> = {};
  for (const r of result.records) {
    byType[r.type] = (byType[r.type] ?? 0) + 1;
  }

  const byNamespace: Record<string, number> = {};
  for (const r of result.records) {
    const root = r.namespace.split('/')[0];
    byNamespace[root] = (byNamespace[root] ?? 0) + 1;
  }

  console.log(`\n  Ingested ${result.records.length} records in ${fmt(elapsed)}`);
  console.log();
  console.log('  By type:');
  for (const [type, count] of Object.entries(byType).sort()) {
    console.log(`    ${type.padEnd(12)} ${count}`);
  }
  console.log();
  console.log('  By root namespace:');
  for (const [ns, count] of Object.entries(byNamespace).sort()) {
    console.log(`    ${ns.padEnd(12)} ${count}`);
  }
  console.log();

  if (result.aliasesCreated !== undefined) {
    console.log(`  Wikilink extraction:`);
    console.log(`    ALIAS records created:  ${result.aliasesCreated}`);
    if (result.unresolvedLinks && result.unresolvedLinks.length > 0) {
      console.log(`    Unresolved targets:     ${result.unresolvedLinks.length}`);
      for (const t of result.unresolvedLinks.slice(0, 10)) {
        console.log(`      - ${t}`);
      }
      if (result.unresolvedLinks.length > 10) {
        console.log(`      ... and ${result.unresolvedLinks.length - 10} more`);
      }
    }
  }

  if (result.errors.length > 0) {
    console.log();
    console.log(`  Errors: ${result.errors.length}`);
    for (const e of result.errors.slice(0, 5)) {
      console.log(`    - ${e.document.id}: ${e.error.message}`);
    }
  }

  console.log('\n──────────────────────────────────────────────────────────────');
  console.log('  Next:');
  console.log('    npm run query              # example queries');
  console.log('    npm run benchmark          # compare retrieval baselines');
  console.log();

  blink.close();
}

main().catch(err => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
