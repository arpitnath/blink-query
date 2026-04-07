/**
 * Blink baseline: BM25 retrieval over WIKI_DERIVERS-classified typed records.
 *
 * Runs the same 15 questions as karpathy-baseline.ts, but uses blink-query's
 * FTS5 index and path-based resolution instead of grep. Reports per-question
 * retrieval time, total hits, and the record type mix of the top result.
 *
 * Prerequisite: run `npm run ingest` first to populate blink.db from the corpus.
 *
 * Run:
 *   node --import tsx/esm benchmark/blink-baseline.ts
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { Blink } from 'blink-query';

interface Question {
  id: string;
  category: string;
  q: string;
}

interface QuestionsFile {
  description: string;
  questions: Question[];
}

const CORPUS_DIR = resolve(import.meta.dirname ?? __dirname, '..');
const BLINK_DB = resolve(CORPUS_DIR, 'data', 'blink.db');
const QUESTIONS_PATH = resolve(import.meta.dirname ?? __dirname, 'questions.json');

function fmt(ms: number): string {
  if (ms < 1) return `<1ms`;
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 2) + '..' : s.padEnd(n);
}

async function main() {
  if (!existsSync(BLINK_DB)) {
    console.error(`\n  Error: ${BLINK_DB} not found.`);
    console.error('  Run `npm run ingest` first to populate the database.\n');
    process.exit(1);
  }

  const raw = readFileSync(QUESTIONS_PATH, 'utf-8');
  const data: QuestionsFile = JSON.parse(raw);

  const blink = new Blink({ dbPath: BLINK_DB });

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(' BLINK BASELINE — FTS5 BM25 over typed records (WIKI_DERIVERS)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  DB:        ${BLINK_DB}`);
  console.log(`  Questions: ${data.questions.length}`);
  console.log('───────────────────────────────────────────────────────────────────────');
  console.log(`  ${pad('Question', 45)} ${pad('Top hit path', 35)} Time`);
  console.log('  ' + '─'.repeat(81));

  let totalMs = 0;
  let totalHits = 0;

  for (const q of data.questions) {
    const t0 = performance.now();
    const hits = blink.search(q.q, { limit: 5 });
    const elapsed = performance.now() - t0;
    totalMs += elapsed;
    totalHits += hits.length;

    const topPath = hits.length > 0 ? hits[0].path : '(no results)';
    console.log(`  ${pad(q.q, 45)} ${pad(topPath, 35)} ${fmt(elapsed)}`);
  }

  console.log('  ' + '─'.repeat(81));
  console.log(
    `  ${' '.repeat(45)} ${'Total hits'.padEnd(35)} ${String(totalHits)}`,
  );
  console.log(
    `  ${' '.repeat(45)} ${'Avg retrieval time'.padEnd(35)} ${fmt(totalMs / data.questions.length)}`,
  );
  console.log(
    `  ${' '.repeat(45)} ${'Total time'.padEnd(35)} ${fmt(totalMs)}`,
  );
  console.log();

  blink.close();
}

main().catch(err => {
  console.error('Blink baseline failed:', err);
  process.exit(1);
});
