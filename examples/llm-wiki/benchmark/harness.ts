/**
 * LLM Wiki Benchmark Harness
 *
 * Runs all available baselines against the llm-wiki corpus and prints
 * a comparison table. Baselines are run via subprocess (npm run bench:*)
 * so each is a standalone script you can run individually.
 *
 * Available baselines:
 *   karpathy  — markdown + grep (always available, no deps)
 *   blink     — blink-query with WIKI_DERIVERS (needs blink.db populated via `npm run ingest`)
 *   rag       — vectra + Ollama (needs local Ollama + nomic-embed-text + ministral-3)
 *   qmd       — Tobi's qmd tool (needs qmd installed separately, best-effort)
 *
 * Run:
 *   npm run benchmark
 *
 * Pass BASELINES=karpathy,blink to run a subset.
 */

import { execSync } from 'child_process';

const DEFAULT_BASELINES = ['karpathy', 'blink'];
const REQUESTED = (process.env.BASELINES ?? DEFAULT_BASELINES.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
console.log('║  LLM Wiki Benchmark Harness                                           ║');
console.log('╚═══════════════════════════════════════════════════════════════════════╝');
console.log(`  Baselines: ${REQUESTED.join(', ')}`);
console.log();

const results: Array<{ baseline: string; status: 'ok' | 'skipped' | 'failed'; reason?: string }> = [];

for (const baseline of REQUESTED) {
  console.log(`\n──── Running: ${baseline} ────`);
  try {
    execSync(`npm run bench:${baseline} --silent`, {
      stdio: 'inherit',
      cwd: new URL('..', import.meta.url).pathname,
    });
    results.push({ baseline, status: 'ok' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ baseline, status: 'failed', reason: msg });
    console.error(`  ✗ ${baseline} failed: ${msg}`);
  }
}

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log(' Summary');
console.log('═══════════════════════════════════════════════════════════════════════');
for (const r of results) {
  const icon = r.status === 'ok' ? '✓' : r.status === 'skipped' ? '○' : '✗';
  console.log(`  ${icon} ${r.baseline.padEnd(12)} ${r.status}${r.reason ? `  (${r.reason})` : ''}`);
}
console.log();
console.log('  For full comparison numbers, see examples/llm-wiki/benchmark/RESULTS.md');
console.log();
