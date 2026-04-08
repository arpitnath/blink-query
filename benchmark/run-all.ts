/**
 * benchmark/run-all.ts — single-command benchmark orchestrator.
 *
 * Runs the full benchmark suite end-to-end:
 *   1. Auto-clones any missing public corpora into benchmark/corpora/
 *   2. Runs benchmark/bench.ts on each corpus (sequentially, isolated process)
 *   3. Reads each per-corpus report.json and prints a unified cross-corpus summary
 *   4. Writes benchmark/results.json with the full machine-readable picture
 *
 * Run from blink-query repo root:
 *   npm run benchmark
 *
 * Or directly:
 *   tsx benchmark/run-all.ts
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { CORPORA, corpusContentRoot } from './setup.js';

// ─── ANSI colors ────────────────────────────────────────────

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const bold = (s: string) => `${C.bold}${s}${C.reset}`;
const dim = (s: string) => `${C.dim}${s}${C.reset}`;
const cyan = (s: string) => `${C.cyan}${s}${C.reset}`;
const yellow = (s: string) => `${C.yellow}${s}${C.reset}`;
const green = (s: string) => `${C.green}${s}${C.reset}`;
const red = (s: string) => `${C.red}${s}${C.reset}`;
const magenta = (s: string) => `${C.magenta}${s}${C.reset}`;

// ─── Helpers ────────────────────────────────────────────────

function pad(s: string, n: number): string {
  // pad ignoring ANSI escape codes
  const visible = s.replace(/\x1b\[[0-9;]*m/g, '');
  return s + ' '.repeat(Math.max(0, n - visible.length));
}

function fmtMs(ms: number): string {
  if (ms < 10) return ms.toFixed(2) + 'ms';
  if (ms < 1000) return ms.toFixed(1) + 'ms';
  return (ms / 1000).toFixed(2) + 's';
}

/** Render a horizontal bar made of █ chars, scaled to the largest value. */
function bar(value: number, max: number, width: number): string {
  if (max <= 0) return '';
  const fillCount = Math.round((value / max) * width);
  return '█'.repeat(fillCount) + dim('░'.repeat(width - fillCount));
}

interface ReportSummary {
  totalQueries: number;
  grep: { mean: number; p50: number; p95: number; max: number;
          foundCount: number; foundPct: number; avgResultCount: number };
  ripgrep: { mean: number; p50: number; p95: number; max: number;
             foundCount: number; foundPct: number; avgResultCount: number };
  blink: { mean: number; p50: number; p95: number; max: number;
           p1Count: number; p1Pct: number; p3Count: number; p3Pct: number;
           avgResultCount: number };
  speedupVsGrep: number;
  speedupVsRg: number;
}

interface Report {
  runAt: string;
  label: string;
  corpusKey: string;
  machine: { platform: string; arch: string; nodeVersion: string };
  corpus: { root: string; walkMs: number; mdFileCount: number;
            mdTotalBytes: number; hubDirCount: number };
  blinkDb: { ingestMs: number; recordsCreated: number; ingestErrors: number; sizeBytes: number };
  summary: ReportSummary;
}

// ─── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  const startedAt = new Date();

  // Forward --verbose to spawned bench.ts subprocesses
  const verbose = process.argv.includes('--verbose');

  console.log();
  console.log(bold(cyan('╔══════════════════════════════════════════════════════════════════════╗')));
  console.log(bold(cyan('║                       blink-query benchmark                          ║')));
  console.log(bold(cyan('╚══════════════════════════════════════════════════════════════════════╝')));
  console.log();
  console.log(dim(`run at: ${startedAt.toISOString()}`));
  console.log(dim(`machine: ${process.platform} ${process.arch}, node ${process.version}`));
  console.log();

  // ── Step 1: ensure corpora are present ────────────────
  console.log(bold('› step 1: corpus setup'));
  try {
    execSync('npx tsx benchmark/setup.ts', { stdio: 'inherit' });
  } catch {
    console.error(red('setup failed — cannot continue'));
    process.exit(1);
  }

  // ── Step 2: run bench.ts on each corpus ────────────────
  console.log();
  console.log(bold('› step 2: per-corpus benchmark runs'));

  const reports: Report[] = [];

  for (const corpus of CORPORA) {
    const root = corpusContentRoot(corpus);
    if (!existsSync(root)) {
      console.error(red(`corpus root missing: ${root}`));
      process.exit(1);
    }
    const corpusKey = corpus.name.split('-')[0]; // 'obsidian-help' → 'obsidian'

    const benchArgs = ['tsx', 'benchmark/bench.ts', root, corpusKey];
    if (verbose) benchArgs.push('--verbose');
    const result = spawnSync('npx', benchArgs, {
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      console.error(red(`bench failed for ${corpus.name}`));
      process.exit(1);
    }

    const reportPath = `benchmark/.tmp/${corpusKey}/report.json`;
    if (!existsSync(reportPath)) {
      console.error(red(`report missing after bench: ${reportPath}`));
      process.exit(1);
    }
    reports.push(JSON.parse(readFileSync(reportPath, 'utf-8')) as Report);
  }

  // ── Step 3: cross-corpus summary ───────────────────────
  console.log();
  console.log();
  console.log(bold(cyan('╔══════════════════════════════════════════════════════════════════════╗')));
  console.log(bold(cyan('║                    CROSS-CORPUS SUMMARY                              ║')));
  console.log(bold(cyan('╚══════════════════════════════════════════════════════════════════════╝')));
  console.log();

  // Latency table
  console.log(bold('  latency (mean per query)'));
  console.log();
  console.log(`  ${dim('corpus'.padEnd(20))} ${dim('files'.padStart(8))}  ${dim(yellow('grep'.padStart(10)))}  ${dim('ripgrep'.padStart(10))}  ${dim(cyan('blink'.padStart(10)))}`);
  console.log(`  ${dim('─'.repeat(20))} ${dim('────────')}  ${dim('──────────')}  ${dim('──────────')}  ${dim('──────────')}`);
  for (const r of reports) {
    console.log(
      `  ${r.label.padEnd(20)} ${String(r.corpus.mdFileCount).padStart(8)}  ` +
      `${pad(yellow(fmtMs(r.summary.grep.mean)), 10)}  ` +
      `${pad(fmtMs(r.summary.ripgrep.mean), 10)}  ` +
      `${pad(bold(cyan(fmtMs(r.summary.blink.mean))), 10)}`
    );
  }
  console.log();

  // Speedup bar chart
  console.log(bold('  blink speedup vs grep'));
  console.log();
  const maxSpeedup = Math.max(...reports.map(r => r.summary.speedupVsGrep));
  for (const r of reports) {
    const sp = r.summary.speedupVsGrep;
    console.log(
      `  ${r.label.padEnd(20)} ${cyan(bar(sp, maxSpeedup, 40))} ${bold(green(sp.toFixed(0) + '×'))}`
    );
  }
  console.log();

  // Accuracy table
  console.log(bold('  accuracy (top result, then top-3)'));
  console.log();
  console.log(`  ${dim('corpus'.padEnd(20))} ${dim('queries'.padStart(8))}  ${dim('grep ✓'.padStart(11))}  ${dim('blink P@1'.padStart(11))}  ${dim('blink P@3'.padStart(11))}`);
  console.log(`  ${dim('─'.repeat(20))} ${dim('────────')}  ${dim('───────────')}  ${dim('───────────')}  ${dim('───────────')}`);
  for (const r of reports) {
    const s = r.summary;
    const grepStr = `${s.grep.foundCount}/${s.totalQueries}`;
    const p1Str = `${s.blink.p1Count}/${s.totalQueries}`;
    const p3Str = `${s.blink.p3Count}/${s.totalQueries}`;
    console.log(
      `  ${r.label.padEnd(20)} ${String(s.totalQueries).padStart(8)}  ` +
      `${pad(yellow(grepStr) + dim(` (${s.grep.foundPct.toFixed(0)}%)`), 11)}  ` +
      `${pad(bold(cyan(p1Str)) + dim(` (${s.blink.p1Pct.toFixed(0)}%)`), 11)}  ` +
      `${pad(bold(cyan(p3Str)) + dim(` (${s.blink.p3Pct.toFixed(0)}%)`), 11)}`
    );
  }
  console.log();

  // Result count per query
  console.log(bold('  result count per query'));
  console.log();
  console.log(`  ${dim('corpus'.padEnd(20))} ${dim('grep'.padStart(11))}  ${dim('blink'.padStart(11))}`);
  console.log(`  ${dim('─'.repeat(20))} ${dim('───────────')}  ${dim('───────────')}`);
  for (const r of reports) {
    const s = r.summary;
    console.log(
      `  ${r.label.padEnd(20)} ${pad(yellow(s.grep.avgResultCount.toFixed(0).padStart(11)), 11)}  ` +
      `${pad(cyan(String(s.blink.avgResultCount).padStart(11)), 11)}`
    );
  }
  console.log();

  // Aggregate stats for the JSON file
  const minSpeedup = Math.min(...reports.map(r => r.summary.speedupVsGrep));
  const maxSpeedupNum = Math.max(...reports.map(r => r.summary.speedupVsGrep));
  const meanP1 = reports.reduce((a, r) => a + r.summary.blink.p1Pct, 0) / reports.length;
  const meanP3 = reports.reduce((a, r) => a + r.summary.blink.p3Pct, 0) / reports.length;

  // ── Step 4: write unified results.json ────────────────
  const unified = {
    runAt: startedAt.toISOString(),
    machine: reports[0]?.machine,
    corpora: reports.map(r => ({
      label: r.label,
      corpusKey: r.corpusKey,
      files: r.corpus.mdFileCount,
      bytes: r.corpus.mdTotalBytes,
      ingestMs: r.blinkDb.ingestMs,
      summary: r.summary,
    })),
    crossCorpus: {
      meanP1Pct: +meanP1.toFixed(1),
      meanP3Pct: +meanP3.toFixed(1),
      minSpeedupVsGrep: +minSpeedup.toFixed(1),
      maxSpeedupVsGrep: +maxSpeedupNum.toFixed(1),
    },
  };

  mkdirSync('benchmark/.tmp', { recursive: true });
  writeFileSync('benchmark/results.json', JSON.stringify(unified, null, 2));

  console.log(dim(`  unified results: benchmark/results.json`));
  console.log();
  const elapsedSec = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(dim(`  total elapsed: ${elapsedSec}s`));
  console.log();
}

main().catch(err => {
  console.error(red('run-all failed:'), err);
  process.exit(1);
});
