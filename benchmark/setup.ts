/**
 * benchmark/setup.ts — auto-clone the public corpora into benchmark/corpora/
 *
 * Idempotent: skips any corpus already present. Each corpus is cloned shallow
 * (`--depth 1`) for speed. The corpora directory is gitignored.
 *
 * CLI:
 *   tsx benchmark/setup.ts          # clone all missing corpora
 *   tsx benchmark/setup.ts --force  # delete and re-clone everything
 *
 * License note: blink-query does NOT redistribute these corpora. Each clone
 * pulls fresh from the upstream repo at run time. Citing the upstream URL
 * + commit SHA in any published benchmark report is recommended.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { resolve, join } from 'path';

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', red: '\x1b[31m',
};
const ok = (s: string) => `${C.green}${s}${C.reset}`;
const dim = (s: string) => `${C.dim}${s}${C.reset}`;
const cyan = (s: string) => `${C.cyan}${s}${C.reset}`;
const bold = (s: string) => `${C.bold}${s}${C.reset}`;

interface CorpusConfig {
  /** Short corpus key — must match a query set in bench.ts (`obsidian` | `mdn` | `quartz`). */
  name: string;
  /** Human-readable corpus label for display. */
  label: string;
  /** Upstream git URL. */
  repo: string;
  /** Subpath inside the cloned repo where the markdown files live. */
  subpath: string;
  /** Approximate clone size for user expectation. */
  approxSize: string;
}

export const CORPORA: CorpusConfig[] = [
  {
    name: 'quartz',
    label: 'Quartz docs',
    repo: 'https://github.com/jackyzha0/quartz.git',
    subpath: 'docs',
    approxSize: '~38 MB',
  },
  {
    name: 'obsidian-help',
    label: 'Obsidian Help vault',
    repo: 'https://github.com/obsidianmd/obsidian-help.git',
    subpath: 'en',
    approxSize: '~30 MB',
  },
  {
    name: 'mdn-content',
    label: 'MDN content',
    repo: 'https://github.com/mdn/content.git',
    subpath: 'files/en-us',
    approxSize: '~200 MB',
  },
];

const CORPORA_DIR = resolve('benchmark/corpora');
const FORCE = process.argv.includes('--force');

function corpusPath(c: CorpusConfig): string {
  return join(CORPORA_DIR, c.name);
}
export function corpusContentRoot(c: CorpusConfig): string {
  return join(corpusPath(c), c.subpath);
}

async function setup(): Promise<void> {
  mkdirSync(CORPORA_DIR, { recursive: true });

  console.log(`${bold(cyan('━━━ benchmark setup ━━━'))}`);
  console.log(dim(`corpora dir: ${CORPORA_DIR}`));
  if (FORCE) console.log(dim('--force: re-cloning everything'));
  console.log();

  for (const corpus of CORPORA) {
    const path = corpusPath(corpus);
    const present = existsSync(path);

    if (present && !FORCE) {
      console.log(`  ${ok('skip')}  ${corpus.label.padEnd(22)} ${dim('(already present)')}`);
      continue;
    }

    if (present && FORCE) {
      rmSync(path, { recursive: true, force: true });
    }

    process.stdout.write(`  ${cyan('clone')} ${corpus.label.padEnd(22)} ${dim(corpus.approxSize + '...')}`);
    try {
      execSync(`git clone --depth 1 --quiet ${corpus.repo} ${JSON.stringify(path)}`, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      // pin commit for reproducibility / citation
      const sha = execSync(`git -C ${JSON.stringify(path)} rev-parse HEAD`, { encoding: 'utf-8' }).trim();
      process.stdout.write(`  ${ok('done')} ${dim('@ ' + sha.slice(0, 7))}\n`);
    } catch (err) {
      process.stdout.write(`  ${C.red}failed${C.reset}\n`);
      console.error(err);
      process.exit(1);
    }
  }

  console.log();
  console.log(ok('✓ all corpora ready'));
  console.log();
  console.log(dim('next: npm run benchmark'));
}

// Run when invoked directly. Module export above lets run-all.ts reuse CORPORA.
const isMain = import.meta.url === `file://${process.argv[1]}` ||
               process.argv[1]?.endsWith('benchmark/setup.ts');
if (isMain) {
  setup().catch(err => {
    console.error('setup failed:', err);
    process.exit(1);
  });
}
