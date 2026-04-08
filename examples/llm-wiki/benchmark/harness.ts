/**
 * LLM Wiki Benchmark Harness
 *
 * Runs both baselines against the llm-wiki corpus in sequence.
 * Each baseline is a standalone script you can run individually via
 * `npm run bench:grep` or `npm run bench:blink`.
 *
 * Baselines:
 *   grep  — recursive grep over markdown files (no deps)
 *   blink — blink-query BM25 over typed records (needs blink.db via `npm run ingest`)
 *
 * Run:
 *   npm run benchmark
 *
 * Pass BASELINES=grep,blink to select a subset (default: both).
 */

import { execSync } from 'child_process';

const DEFAULT_BASELINES = ['grep', 'blink'];
const REQUESTED = (process.env.BASELINES ?? DEFAULT_BASELINES.join(','))
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
console.log('║  LLM Wiki Benchmark Harness                                           ║');
console.log('╚═══════════════════════════════════════════════════════════════════════╝');
console.log(`  Baselines: ${REQUESTED.join(', ')}`);
console.log();

const results: Array<{ baseline: string; status: 'ok' | 'failed'; reason?: string }> = [];

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
  const icon = r.status === 'ok' ? '✓' : '✗';
  console.log(`  ${icon} ${r.baseline.padEnd(12)} ${r.status}${r.reason ? `  (${r.reason})` : ''}`);
}
console.log();
console.log('  For the committed comparison numbers, see examples/llm-wiki/benchmark/RESULTS.md');
console.log();
