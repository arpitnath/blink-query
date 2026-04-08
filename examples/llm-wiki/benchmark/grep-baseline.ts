/**
 * Grep baseline: plain markdown + recursive grep over the corpus.
 *
 * No index, no classifier, no database — just the filesystem and a text
 * search tool. This is the simplest possible retrieval approach against
 * which typed-record retrieval (blink-query) is measured.
 *
 * For each question in questions.json:
 *   1. Extract 2-3 keyword terms (stopword-stripped)
 *   2. grep the corpus for files matching those terms (case-insensitive)
 *   3. Report: matched file count, time taken
 *
 * Run:
 *   node --import tsx/esm benchmark/grep-baseline.ts
 */

import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve } from 'path';

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
const QUESTIONS_PATH = resolve(import.meta.dirname ?? __dirname, 'questions.json');

/** Naive keyword extractor: split on whitespace, strip punctuation, drop stopwords. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'and', 'or', 'but', 'if', 'of', 'for', 'to', 'in', 'on', 'at', 'by',
  'with', 'from', 'as', 'this', 'that', 'these', 'those', 'it', 'its',
  'what', 'who', 'how', 'why', 'when', 'where', 'which', 'do', 'does',
  'did', 'has', 'have', 'had', 'can', 'could', 'should', 'would',
  'will', 'may', 'might', 'must', 'shall', 'about', 'than',
]);

function extractKeywords(question: string, max = 3): string[] {
  return question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w))
    .slice(0, max);
}

/** Run grep across the corpus for a single keyword, return file paths with matches. */
function grepCorpus(keyword: string): string[] {
  try {
    const out = execSync(
      `grep -r -l -i "${keyword.replace(/["\\]/g, '\\$&')}" ${CORPUS_DIR}/sources ${CORPUS_DIR}/entity ${CORPUS_DIR}/topics 2>/dev/null || true`,
      { encoding: 'utf-8' },
    );
    return out.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

function fmt(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 2) + '..' : s.padEnd(n);
}

async function main() {
  const raw = readFileSync(QUESTIONS_PATH, 'utf-8');
  const data: QuestionsFile = JSON.parse(raw);

  console.log('\n═══════════════════════════════════════════════════════════════════════');
  console.log(' GREP BASELINE — recursive grep over markdown files');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`  Corpus:    ${CORPUS_DIR}`);
  console.log(`  Questions: ${data.questions.length}`);
  console.log('───────────────────────────────────────────────────────────────────────');
  console.log(`  ${pad('Question', 45)} ${pad('Keywords', 22)} Hits   Time`);
  console.log('  ' + '─'.repeat(69));

  let totalHits = 0;
  let totalMs = 0;

  for (const q of data.questions) {
    const keywords = extractKeywords(q.q);
    const t0 = Date.now();
    const allHits = new Set<string>();
    for (const kw of keywords) {
      for (const file of grepCorpus(kw)) allHits.add(file);
    }
    const elapsed = Date.now() - t0;
    totalHits += allHits.size;
    totalMs += elapsed;

    console.log(
      `  ${pad(q.q, 45)} ${pad(keywords.join(','), 22)} ${String(allHits.size).padStart(4)}   ${fmt(elapsed)}`,
    );
  }

  console.log('  ' + '─'.repeat(69));
  console.log(
    `  ${' '.repeat(45)} ${'Total'.padEnd(22)} ${String(totalHits).padStart(4)}   ${fmt(totalMs)}`,
  );
  console.log(
    `  ${' '.repeat(45)} ${'Average'.padEnd(22)} ${'   -'}   ${fmt(totalMs / data.questions.length)}`,
  );
  console.log();
}

main().catch(err => {
  console.error('Grep baseline failed:', err);
  process.exit(1);
});
