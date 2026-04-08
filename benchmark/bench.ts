/**
 * blink-query benchmark — single-corpus runner.
 *
 * Compares blink-query against grep and ripgrep on a markdown corpus,
 * with verifiable per-query oracles. Universal across corpus shapes:
 * one configuration, no per-corpus tuning.
 *
 * CLI:
 *   tsx benchmark/bench.ts <root-dir> <corpus-key>
 *
 * Examples:
 *   tsx benchmark/bench.ts benchmark/corpora/quartz/docs quartz
 *   tsx benchmark/bench.ts benchmark/corpora/obsidian-help/en obsidian
 *   tsx benchmark/bench.ts benchmark/corpora/mdn-content/files/en-us mdn
 *
 * Output:
 *   benchmark/.tmp/<corpus-key>/report.json — machine-readable
 *   stdout — colored summary
 */

import { readFileSync, statSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, basename, dirname, resolve } from 'path';
import { execSync } from 'child_process';
import { Blink } from '../src/blink.js';
import type { IngestOptions } from '../src/types.js';

// ─── CLI args ───────────────────────────────────────────────

// Filter out flags so positional args still resolve correctly
const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const VERBOSE = process.argv.includes('--verbose');

const ROOT = resolve(positional[0] || '');
const LABEL = positional[1] || 'corpus';
const CORPUS_KEY = LABEL.split('-')[0] as 'obsidian' | 'mdn' | 'quartz';

if (!ROOT || !existsSync(ROOT)) {
  console.error(`Usage: tsx benchmark/bench.ts <root-dir> <corpus-key> [--verbose]`);
  console.error(`  corpus-key must be one of: obsidian, mdn, quartz`);
  console.error(`  --verbose: print query text and blink top-5 paths under each query`);
  console.error(`  ROOT not found: ${ROOT || '(empty)'}`);
  process.exit(1);
}

const OUT_DIR = `benchmark/.tmp/${LABEL}`;
const DB_PATH = `${OUT_DIR}/blink.db`;
const REPORT_PATH = `${OUT_DIR}/report.json`;
const FILE_LIST_PATH = `${OUT_DIR}/files.txt`;

// ─── ANSI colors (no deps) ─────────────────────────────────

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};
const ok = (s: string) => `${C.green}${s}${C.reset}`;
const bad = (s: string) => `${C.red}${s}${C.reset}`;
const cyan = (s: string) => `${C.cyan}${s}${C.reset}`;
const yellow = (s: string) => `${C.yellow}${s}${C.reset}`;
const dim = (s: string) => `${C.dim}${s}${C.reset}`;
const bold = (s: string) => `${C.bold}${s}${C.reset}`;
const tick = ok('✓');
const cross = bad('✗');

// ─── Standard exclude list ─────────────────────────────────
// Same as the library's DEFAULT_IGNORE_DIRS, plus a few more vendor dirs.
const EXCLUDE_DIR_NAMES = new Set([
  'node_modules', 'dist', 'build', '.git', '.next', '.turbo', 'coverage', '.cache',
  '.venv', 'venv', '__pycache__', 'site-packages', 'target',
  '.husky', '.vscode', '.github',
]);

// ─── Query types ────────────────────────────────────────────

interface Query {
  id: string;
  type: 'entity' | 'procedural' | 'concept' | 'reference';
  query: string;
  grepTerm: string;
  oracle: RegExp;
  appliesTo: ('obsidian' | 'mdn' | 'quartz')[];
}

const QUERIES: Query[] = [
  // ─── Obsidian Help vault queries (171 files, curated wiki) ───
  // Source: github.com/obsidianmd/obsidian-help — en/ subdir
  { id: 'ob-entity-1', type: 'entity', query: 'what is Obsidian Sync', grepTerm: 'Obsidian Sync',
    oracle: /\/en\/Obsidian Sync\/Introduction to Obsidian Sync\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-entity-2', type: 'entity', query: 'what is Obsidian Publish', grepTerm: 'Obsidian Publish',
    oracle: /\/en\/Obsidian Publish\/Introduction to Obsidian Publish\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-entity-3', type: 'entity', query: 'what is Obsidian Web Clipper', grepTerm: 'Web Clipper',
    oracle: /\/en\/Obsidian Web Clipper\/Introduction to Obsidian Web Clipper\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-entity-4', type: 'entity', query: 'what are bases in obsidian', grepTerm: 'Bases',
    oracle: /\/en\/Bases\/Introduction to Bases\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-entity-5', type: 'entity', query: 'what is the canvas in obsidian', grepTerm: 'Canvas',
    oracle: /\/en\/Plugins\/Canvas\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-proc-1', type: 'procedural', query: 'how to set up obsidian sync', grepTerm: 'Set up Obsidian Sync',
    oracle: /\/en\/Obsidian Sync\/Set up Obsidian Sync\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-proc-2', type: 'procedural', query: 'how to create daily notes', grepTerm: 'daily note',
    oracle: /\/en\/Plugins\/Daily notes\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-proc-3', type: 'procedural', query: 'how to create internal links', grepTerm: 'internal link',
    oracle: /\/en\/Linking notes and files\/Internal links\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-proc-4', type: 'procedural', query: 'how to download and install obsidian', grepTerm: 'Download and install',
    oracle: /\/en\/Getting started\/Download and install Obsidian\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-proc-5', type: 'procedural', query: 'how to create a vault in obsidian', grepTerm: 'create a vault',
    oracle: /\/en\/Getting started\/Create a vault\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-proc-6', type: 'procedural', query: 'how to use callouts', grepTerm: 'callout',
    oracle: /\/en\/Editing and formatting\/Callouts\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-concept-1', type: 'concept', query: 'what are backlinks in obsidian', grepTerm: 'backlinks',
    oracle: /\/en\/Plugins\/Backlinks\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-concept-2', type: 'concept', query: 'what are properties in obsidian', grepTerm: 'properties',
    oracle: /\/en\/(Editing and formatting\/Properties|Plugins\/Properties view)\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-concept-3', type: 'concept', query: 'obsidian flavored markdown', grepTerm: 'Obsidian Flavored Markdown',
    oracle: /\/en\/Editing and formatting\/Obsidian Flavored Markdown\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-ref-1', type: 'reference', query: 'obsidian sync plans and pricing', grepTerm: 'Plans and storage',
    oracle: /\/en\/Obsidian Sync\/Plans and storage limits\.md$/, appliesTo: ['obsidian'] },
  { id: 'ob-ref-2', type: 'reference', query: 'obsidian publish custom domains', grepTerm: 'custom domain',
    oracle: /\/en\/Obsidian Publish\/Custom domains\.md$/, appliesTo: ['obsidian'] },

  // ─── MDN content queries (~14,251 files, dense reference docs) ───
  // Source: github.com/mdn/content — files/en-us subdir
  { id: 'mdn-entity-1', type: 'entity', query: 'what is Array.prototype.map in JavaScript', grepTerm: 'Array.prototype.map',
    oracle: /\/web\/javascript\/reference\/global_objects\/array\/map\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-entity-2', type: 'entity', query: 'what is a JavaScript Promise', grepTerm: 'Promise',
    oracle: /\/web\/javascript\/reference\/global_objects\/promise\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-entity-3', type: 'entity', query: 'what is the Canvas API', grepTerm: 'Canvas API',
    oracle: /\/web\/api\/canvas_api\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-entity-4', type: 'entity', query: 'what is the Service Worker API', grepTerm: 'Service Worker',
    oracle: /\/web\/api\/service_worker_api\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-entity-5', type: 'entity', query: 'what is the DOM', grepTerm: 'DOM',
    oracle: /\/glossary\/dom\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-proc-1', type: 'procedural', query: 'how to use addEventListener', grepTerm: 'addEventListener',
    oracle: /\/web\/api\/eventtarget\/addeventlistener\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-proc-2', type: 'procedural', query: 'how to use querySelector', grepTerm: 'querySelector',
    oracle: /\/web\/api\/document\/queryselector\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-proc-3', type: 'procedural', query: 'how to use localStorage', grepTerm: 'localStorage',
    oracle: /\/web\/api\/window\/localstorage\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-proc-4', type: 'procedural', query: 'how to make HTTP requests with fetch', grepTerm: 'fetch',
    oracle: /\/web\/api\/window\/fetch\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-proc-5', type: 'procedural', query: 'how to use async function', grepTerm: 'async function',
    oracle: /\/web\/javascript\/reference\/operators\/async_function\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-proc-6', type: 'procedural', query: 'how to use JSON parse', grepTerm: 'JSON.parse',
    oracle: /\/web\/javascript\/reference\/global_objects\/json\/parse\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-ref-1', type: 'reference', query: 'CSS display property', grepTerm: 'display',
    oracle: /\/web\/css\/reference\/properties\/display\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-ref-2', type: 'reference', query: 'CSS media query', grepTerm: '@media',
    oracle: /\/web\/css\/reference\/at-rules\/@media\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-ref-3', type: 'reference', query: 'CSS color property', grepTerm: 'color',
    oracle: /\/web\/css\/reference\/properties\/color\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-ref-4', type: 'reference', query: 'HTML input element', grepTerm: 'input element',
    oracle: /\/web\/html\/reference\/elements\/input\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-ref-5', type: 'reference', query: 'JavaScript for loop statement', grepTerm: 'for statement',
    oracle: /\/web\/javascript\/reference\/statements\/for\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-concept-1', type: 'concept', query: 'what is a closure in JavaScript', grepTerm: 'closure',
    oracle: /\/glossary\/closure\/index\.md$/, appliesTo: ['mdn'] },
  { id: 'mdn-concept-2', type: 'concept', query: 'regular expressions in JavaScript', grepTerm: 'regular expressions',
    oracle: /\/web\/javascript\/guide\/regular_expressions\/index\.md$/, appliesTo: ['mdn'] },

  // ─── Quartz docs queries (~76 files, digital garden style) ───
  // Source: github.com/jackyzha0/quartz — docs/ subdir
  { id: 'qz-entity-1', type: 'entity', query: 'what is Quartz', grepTerm: 'Quartz',
    oracle: /\/quartz\/docs\/index\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-entity-2', type: 'entity', query: 'philosophy of Quartz', grepTerm: 'philosophy',
    oracle: /\/quartz\/docs\/philosophy\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-proc-1', type: 'procedural', query: 'how to configure Quartz', grepTerm: 'configuration',
    oracle: /\/quartz\/docs\/configuration\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-proc-2', type: 'procedural', query: 'how to host a Quartz site', grepTerm: 'hosting',
    oracle: /\/quartz\/docs\/hosting\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-proc-3', type: 'procedural', query: 'how to build Quartz', grepTerm: 'build',
    oracle: /\/quartz\/docs\/build\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-proc-4', type: 'procedural', query: 'how to upgrade Quartz', grepTerm: 'upgrading',
    oracle: /\/quartz\/docs\/upgrading\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-proc-5', type: 'procedural', query: 'how to author content in Quartz', grepTerm: 'authoring content',
    oracle: /\/quartz\/docs\/authoring content\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-feat-1', type: 'reference', query: 'callouts feature in Quartz', grepTerm: 'callouts',
    oracle: /\/quartz\/docs\/features\/callouts\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-feat-2', type: 'reference', query: 'backlinks in Quartz', grepTerm: 'backlinks',
    oracle: /\/quartz\/docs\/features\/backlinks\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-feat-3', type: 'reference', query: 'graph view in Quartz', grepTerm: 'graph view',
    oracle: /\/quartz\/docs\/features\/graph view\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-feat-4', type: 'reference', query: 'full text search in Quartz', grepTerm: 'full-text search',
    oracle: /\/quartz\/docs\/features\/full-text search\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-feat-5', type: 'reference', query: 'Mermaid diagrams in Quartz', grepTerm: 'Mermaid',
    oracle: /\/quartz\/docs\/features\/Mermaid diagrams\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-concept-1', type: 'concept', query: 'how Quartz layout system works', grepTerm: 'layout',
    oracle: /\/quartz\/docs\/layout(-components)?\.md$/, appliesTo: ['quartz'] },
  { id: 'qz-concept-2', type: 'concept', query: 'Quartz architecture', grepTerm: 'architecture',
    oracle: /\/quartz\/docs\/advanced\/architecture\.md$/, appliesTo: ['quartz'] },
];

// ─── Walker (mirrors loadDirectoryBasic's hub-detection logic) ───

async function walkMarkdown(root: string): Promise<{ files: string[]; hubDirs: Set<string> }> {
  const out: string[] = [];
  const hubDirs = new Set<string>();

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const hasSubdirs = entries.some(
      e => e.isDirectory() && !EXCLUDE_DIR_NAMES.has(e.name) && !e.name.startsWith('.'),
    );
    if (hasSubdirs) hubDirs.add(dir);

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        out.push(join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return { files: out, hubDirs };
}

// ─── Stats helpers ──────────────────────────────────────────

function pct(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stats(arr: number[]) {
  return {
    mean: +mean(arr).toFixed(2),
    p50: pct(arr, 0.5),
    p95: pct(arr, 0.95),
    max: arr.length ? Math.max(...arr) : 0,
  };
}

// ─── Main ───────────────────────────────────────────────────

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(DB_PATH)) rmSync(DB_PATH);

  console.log(`\n${bold(cyan(`━━━ ${LABEL.toUpperCase()} ━━━`))}`);
  console.log(dim(`corpus: ${ROOT}`));

  // ── Walk corpus ────────────────────────────────────────
  const walkStart = Date.now();
  const { files, hubDirs } = await walkMarkdown(ROOT);
  const walkMs = Date.now() - walkStart;

  let totalBytes = 0;
  for (const f of files) {
    try { totalBytes += statSync(f).size; } catch { /* ignore */ }
  }
  console.log(
    dim(`walk: `) +
    `${bold(String(files.length))} markdown files, ` +
    `${bold((totalBytes / 1024 / 1024).toFixed(1) + ' MB')}, ` +
    `${hubDirs.size} hub dirs, ` +
    dim(`${walkMs}ms`),
  );

  // NUL-separated so xargs -0 handles paths containing spaces correctly
  writeFileSync(FILE_LIST_PATH, files.join('\0'));

  // ── Ingest into blink ──────────────────────────────────
  const blink = new Blink({ dbPath: DB_PATH });

  // Build documents. Mirrors loadDirectoryBasic's hub-detection so the library's
  // defaultClassify can promote canonical hub pages to SUMMARY automatically.
  const docs = files.map((path, i) => {
    let body = '';
    try { body = readFileSync(path, 'utf-8'); } catch { /* unreadable */ }

    const parentDir = dirname(path);
    const fileName = basename(path);
    const fileStem = fileName.replace(/\.md$/i, '');
    const isCanonicalName = /^(index|readme|home|about)$/i.test(fileStem);
    const parentIsHub = hubDirs.has(parentDir);

    return {
      id: `doc-${i}`,
      text: body,
      metadata: {
        file_path: path,
        file_name: fileName,
        file_type: 'md',
        is_canonical: isCanonicalName,
        is_hub: isCanonicalName && parentIsHub,
      },
    };
  });

  // Single ingest config — universal across corpus shapes.
  // The library handles everything: title-weighted BM25, hub-aware
  // defaultClassify, parent-dir-fallback filesystemTitle.
  const ingestOptions: IngestOptions = {
    deriveNamespace: (metadata) => {
      const fp = (metadata.file_path as string) || '';
      const rel = fp.replace(ROOT, '').replace(/^\//, '');
      const segments = rel.split('/');
      const dir = segments.slice(0, -1).join('/').replace(/\.\.+/g, '_');
      return dir || CORPUS_KEY;
    },
    sourceType: 'file',
  };

  const ingestStart = Date.now();
  const ingestResult = await blink.ingest(docs, ingestOptions);
  const ingestMs = Date.now() - ingestStart;
  const dbSize = statSync(DB_PATH).size;
  console.log(
    dim(`ingest: `) +
    `${bold(String(ingestResult.records.length))} records in ${bold(ingestMs + 'ms')}, ` +
    `${bold((dbSize / 1024 / 1024).toFixed(1) + ' MB')} on disk`,
  );

  // ── Run queries ────────────────────────────────────────
  const applicableQueries = QUERIES.filter(q => q.appliesTo.includes(CORPUS_KEY));
  if (applicableQueries.length === 0) {
    console.error(bad(`\nNo queries defined for corpus '${CORPUS_KEY}'.`));
    process.exit(1);
  }
  console.log(dim(`\nqueries: ${applicableQueries.length}`));
  console.log();

  const queryResults: any[] = [];
  for (const q of applicableQueries) {
    // grep
    const grepStart = Date.now();
    let grepFiles: string[] = [];
    try {
      const cmd = `xargs -0 grep -l -F -i ${JSON.stringify(q.grepTerm)} < ${FILE_LIST_PATH} 2>/dev/null || true`;
      const out = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      grepFiles = out.trim().split('\n').filter(Boolean);
    } catch { /* no matches */ }
    const grepMs = Date.now() - grepStart;

    // ripgrep
    const rgStart = Date.now();
    let rgFiles: string[] = [];
    try {
      const cmd = `xargs -0 rg -l -F -i ${JSON.stringify(q.grepTerm)} 2>/dev/null < ${FILE_LIST_PATH} || true`;
      const out = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 });
      rgFiles = out.trim().split('\n').filter(Boolean);
    } catch { /* no matches */ }
    const rgMs = Date.now() - rgStart;

    // blink
    const blinkStart = Date.now();
    const blinkResults = blink.search(q.query, { limit: 5 });
    const blinkMs = Date.now() - blinkStart;

    // score
    const grepFound = grepFiles.some(f => q.oracle.test(f));
    const rgFound = rgFiles.some(f => q.oracle.test(f));
    const blinkPaths = blinkResults.map(r => {
      const src = r.sources?.[0];
      return (src && (src as any).file_path) || '';
    });
    const blinkP1 = blinkPaths[0] ? q.oracle.test(blinkPaths[0]) : false;
    const blinkP3 = blinkPaths.slice(0, 3).some(p => p && q.oracle.test(p));

    // Make blink result paths relative to ROOT for readable output
    const blinkRel = blinkPaths.map(p => p.replace(ROOT + '/', '').replace(ROOT, ''));

    queryResults.push({
      id: q.id, type: q.type, query: q.query, grepTerm: q.grepTerm,
      oracleSource: q.oracle.source,
      grep: { ms: grepMs, count: grepFiles.length, found: grepFound },
      ripgrep: { ms: rgMs, count: rgFiles.length, found: rgFound },
      blink: {
        ms: blinkMs,
        count: blinkResults.length,
        p1: blinkP1,
        p3: blinkP3,
        top5: blinkRel,
      },
    });

    if (VERBOSE) {
      // Verbose: query text on its own line, then metrics, then blink top-5 with oracle annotation
      console.log(`  ${dim(q.id.padEnd(13))} "${q.query}"`);
      console.log(
        `    ${yellow('grep')} ${String(grepMs).padStart(4)}ms ${dim(`(${String(grepFiles.length).padStart(4)} hits)`)} ${grepFound ? tick : cross}  ` +
        `${dim('rg')} ${String(rgMs).padStart(4)}ms ${dim(`(${String(rgFiles.length).padStart(4)})`)} ${rgFound ? tick : cross}  ` +
        `${cyan('blink')} ${String(blinkMs).padStart(4)}ms  P@1 ${blinkP1 ? tick : cross}  P@3 ${blinkP3 ? tick : cross}`,
      );
      console.log(`    ${dim('blink top-5:')}`);
      blinkPaths.forEach((fullPath, i) => {
        const relPath = blinkRel[i];
        const isOracle = q.oracle.test(fullPath);
        const oracleNote = isOracle ? `  ${ok('← oracle')}` : '';
        console.log(`      ${dim(String(i + 1) + '.')} ${relPath}${oracleNote}`);
      });
      console.log();
    } else {
      // Compact: one line per query
      console.log(
        `  ${dim(q.id.padEnd(13))} ` +
        `${yellow('grep')} ${String(grepMs).padStart(4)}ms ${dim(`(${String(grepFiles.length).padStart(4)})`)} ${grepFound ? tick : cross}  ` +
        `${dim('rg')} ${String(rgMs).padStart(4)}ms ${dim(`(${String(rgFiles.length).padStart(4)})`)} ${rgFound ? tick : cross}  ` +
        `${cyan('blink')} ${String(blinkMs).padStart(4)}ms  P@1 ${blinkP1 ? tick : cross}  P@3 ${blinkP3 ? tick : cross}`,
      );
    }
  }

  // ── Aggregate ──────────────────────────────────────────
  const grepStats = stats(queryResults.map(r => r.grep.ms));
  const rgStats = stats(queryResults.map(r => r.ripgrep.ms));
  const blinkStats = stats(queryResults.map(r => r.blink.ms));

  const grepFoundCount = queryResults.filter(r => r.grep.found).length;
  const rgFoundCount = queryResults.filter(r => r.ripgrep.found).length;
  const blinkP1Count = queryResults.filter(r => r.blink.p1).length;
  const blinkP3Count = queryResults.filter(r => r.blink.p3).length;
  const grepAvgCount = mean(queryResults.map(r => r.grep.count));
  const rgAvgCount = mean(queryResults.map(r => r.ripgrep.count));

  const speedupVsGrep = blinkStats.mean > 0 ? grepStats.mean / blinkStats.mean : 0;
  const speedupVsRg = blinkStats.mean > 0 ? rgStats.mean / blinkStats.mean : 0;

  const report = {
    runAt: new Date().toISOString(),
    label: LABEL,
    corpusKey: CORPUS_KEY,
    machine: {
      platform: process.platform, arch: process.arch, nodeVersion: process.version,
    },
    corpus: {
      root: ROOT, walkMs,
      mdFileCount: files.length,
      mdTotalBytes: totalBytes,
      hubDirCount: hubDirs.size,
    },
    blinkDb: {
      ingestMs,
      recordsCreated: ingestResult.records.length,
      ingestErrors: ingestResult.errors.length,
      sizeBytes: dbSize,
    },
    queries: queryResults,
    summary: {
      totalQueries: applicableQueries.length,
      grep: { ...grepStats, foundCount: grepFoundCount,
        foundPct: +(grepFoundCount / applicableQueries.length * 100).toFixed(1),
        avgResultCount: +grepAvgCount.toFixed(1) },
      ripgrep: { ...rgStats, foundCount: rgFoundCount,
        foundPct: +(rgFoundCount / applicableQueries.length * 100).toFixed(1),
        avgResultCount: +rgAvgCount.toFixed(1) },
      blink: { ...blinkStats,
        p1Count: blinkP1Count,
        p1Pct: +(blinkP1Count / applicableQueries.length * 100).toFixed(1),
        p3Count: blinkP3Count,
        p3Pct: +(blinkP3Count / applicableQueries.length * 100).toFixed(1),
        avgResultCount: 5 },
      speedupVsGrep: +speedupVsGrep.toFixed(1),
      speedupVsRg: +speedupVsRg.toFixed(1),
    },
  };

  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // ── Per-corpus summary card ────────────────────────────
  console.log();
  console.log(`  ${bold('latency')}    ${dim('mean')}      ${dim('p50')}     ${dim('p95')}     ${dim('max')}`);
  console.log(`  ${yellow('grep   ')}   ${(grepStats.mean + 'ms').padEnd(9)} ${(grepStats.p50 + 'ms').padEnd(7)} ${(grepStats.p95 + 'ms').padEnd(7)} ${grepStats.max}ms`);
  console.log(`  ${dim('ripgrep')}   ${(rgStats.mean + 'ms').padEnd(9)} ${(rgStats.p50 + 'ms').padEnd(7)} ${(rgStats.p95 + 'ms').padEnd(7)} ${rgStats.max}ms`);
  console.log(`  ${cyan('blink  ')}   ${bold((blinkStats.mean + 'ms').padEnd(9))} ${(blinkStats.p50 + 'ms').padEnd(7)} ${(blinkStats.p95 + 'ms').padEnd(7)} ${blinkStats.max}ms`);
  console.log();
  console.log(`  ${bold('accuracy')}`);
  console.log(`  ${yellow('grep   ')}   ${grepFoundCount}/${applicableQueries.length} found ${dim(`(${(grepFoundCount / applicableQueries.length * 100).toFixed(0)}%)`)}, ${grepAvgCount.toFixed(0)} avg files`);
  console.log(`  ${dim('ripgrep')}   ${rgFoundCount}/${applicableQueries.length} found ${dim(`(${(rgFoundCount / applicableQueries.length * 100).toFixed(0)}%)`)}, ${rgAvgCount.toFixed(0)} avg files`);
  console.log(`  ${cyan('blink  ')}   P@1 ${bold(`${blinkP1Count}/${applicableQueries.length}`)} ${dim(`(${(blinkP1Count / applicableQueries.length * 100).toFixed(0)}%)`)}, P@3 ${bold(`${blinkP3Count}/${applicableQueries.length}`)} ${dim(`(${(blinkP3Count / applicableQueries.length * 100).toFixed(0)}%)`)}, top-5`);
  console.log();
  console.log(`  ${bold('speedup')}    blink vs grep ${ok(speedupVsGrep.toFixed(0) + '×')}   blink vs ripgrep ${ok(speedupVsRg.toFixed(0) + '×')}`);
  console.log();
  console.log(dim(`  report: ${REPORT_PATH}`));

  blink.close();
}

main().catch(err => {
  console.error(bad('benchmark failed:'), err);
  process.exit(1);
});
