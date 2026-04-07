/**
 * Pathfinder ingest pipeline — multi-repo.
 *
 * Phase 1 — Blink: fetch GitHub issues from multiple repos into blink.db
 * Phase 2 — Vectra: chunk all records, embed via Ollama, build vector index
 *
 * Config (env vars):
 *   REPOS        Comma-separated repos (default: 4 popular repos)
 *   MAX_PAGES    Pages per repo (default: 30)
 *   BLINK_DB     SQLite file path (default: ./data/blink.db)
 *   VECTRA_DIR   Vectra index directory (default: ./data/vectra-index)
 *   GITHUB_TOKEN GitHub PAT for higher rate limits
 *
 * Run:
 *   npm run ingest
 *   REPOS=facebook/react,vitejs/vite MAX_PAGES=10 npm run ingest
 */

import { mkdirSync } from 'fs';
import { Blink, GITHUB_DERIVERS, extractiveSummarize } from 'blink-query';
import type { RecordType } from 'blink-query';
import { LocalIndex } from 'vectra';
import { OLLAMA_BASE, EMBED_MODEL } from './model.js';

// --- Config ---

const DEFAULT_REPOS = [
  'vercel/next.js',
  'facebook/react',
  'vitejs/vite',
  'sveltejs/svelte',
];

const REPOS = (process.env.REPOS ?? DEFAULT_REPOS.join(',')).split(',').map((r) => r.trim());
const MAX_PAGES = parseInt(process.env.MAX_PAGES ?? '30', 10);
const BLINK_DB = process.env.BLINK_DB ?? './data/blink.db';
const VECTRA_DIR = process.env.VECTRA_DIR ?? './data/vectra-index';

// --- Helpers ---

/** Sliding window text chunker. */
function chunkText(text: string, size = 500, overlap = 50): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + size));
    if (start + size >= text.length) break;
    start += size - overlap;
  }
  return chunks;
}

/** Batch embed texts via Ollama /api/embed. Returns one vector per input text. */
async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Ollama embed error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { embeddings: number[][] };
  return data.embeddings;
}

// --- GitHub issue classifier ---

/** Rule-based type classification for GitHub issues. */
function githubClassify(_text: string, metadata: Record<string, unknown>): RecordType {
  const state = metadata.state as string;
  const labels = ((metadata.labels as string[]) || []).map((l) => l.toLowerCase());
  const text = _text.toLowerCase();

  // Duplicate issues
  if (labels.includes('duplicate') || text.includes('duplicate of #')) return 'SOURCE';

  // Config/settings-related issues → META
  if (labels.some((l) => l.includes('config') || l.includes('setting') || l.includes('next.config')))
    return 'META';

  // Closed issues = resolved knowledge → SUMMARY
  if (state === 'closed') return 'SUMMARY';

  // Open issues = unresolved, need full context → SOURCE
  return 'SOURCE';
}

// --- Main ---

async function main() {
  const startTime = Date.now();

  mkdirSync('./data', { recursive: true });

  console.log('=== Pathfinder Ingest (multi-repo) ===');
  console.log(`Repos:     ${REPOS.join(', ')}`);
  console.log(`Max pages: ${MAX_PAGES} per repo`);
  console.log(`Blink DB:  ${BLINK_DB}`);
  console.log(`Vectra:    ${VECTRA_DIR}\n`);

  const blink = new Blink({ dbPath: BLINK_DB });

  // ─── Phase 1: Blink ingest (per repo) ─────────────────────

  console.log('Phase 1: Ingesting GitHub issues into Blink...\n');

  let totalRecords = 0;
  let totalElapsed = 0;

  for (const repo of REPOS) {
    console.log(`  [${repo}]`);

    try {
      const result = await blink.ingestFromGitHub(
        { repo, maxPages: MAX_PAGES, state: 'all' },
        {
          ...GITHUB_DERIVERS,
          classify: githubClassify,
          summarize: extractiveSummarize(500),
          onBatchComplete: ({ processed, total }) => {
            process.stdout.write(`\r    ${processed}/${total} issues...`);
          },
        },
      );

      totalRecords += result.records.length;
      totalElapsed += result.elapsed;
      console.log(`\r    ${result.records.length} records (${result.elapsed}ms)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\r    FAILED: ${msg}`);
    }
  }

  // Count types across all repos
  const allRecs = blink.list('github', 'recent', { limit: 10000 });
  const typeCounts: Record<string, number> = {};
  for (const r of allRecs) typeCounts[r.type] = (typeCounts[r.type] || 0) + 1;

  const zones = blink.zones();
  console.log(`\nPhase 1 done: ${totalRecords} records across ${zones.length} zones (${totalElapsed}ms)`);
  console.log(`  Types: ${Object.entries(typeCounts).map(([t, c]) => `${t}=${c}`).join(', ')}\n`);

  // ─── Phase 2: Vectra vector index ────────────────────────

  console.log('Phase 2: Building Vectra vector index...');

  const index = new LocalIndex(VECTRA_DIR);
  await index.createIndex({ version: 1, deleteIfExists: true });

  // Gather all records from every zone
  const allRecords = zones.flatMap((z) => blink.list(z.path, 'recent', { limit: 10000 }));
  console.log(`  ${allRecords.length} records across ${zones.length} zones`);

  // Chunk each record's title + summary
  type ChunkMeta = { text: string; path: string; title: string; type: string; chunk_index: number };
  const chunks: ChunkMeta[] = [];
  for (const record of allRecords) {
    const text = `${record.title}\n${record.summary ?? ''}`.trim();
    chunkText(text).forEach((c, i) =>
      chunks.push({ text: c, path: record.path, title: record.title, type: record.type, chunk_index: i }),
    );
  }
  console.log(`  Chunked into ${chunks.length} chunks (500 chars, 50 overlap)`);

  // Batch embed + insert into Vectra
  const BATCH_SIZE = 32;
  let inserted = 0;

  await index.beginUpdate();
  try {
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const vectors = await embedBatch(batch.map((c) => c.text));

      for (let j = 0; j < batch.length; j++) {
        const { text, path, title, type, chunk_index } = batch[j];
        await index.insertItem({
          vector: vectors[j],
          metadata: { path, title, type, chunk: text, chunk_index },
        });
        inserted++;
      }

      process.stdout.write(`\r  Embedded ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length} chunks...`);
    }
    await index.endUpdate();
  } catch (err) {
    index.cancelUpdate();
    throw err;
  }

  // ─── Summary ─────────────────────────────────────────────

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\n=== Done in ${elapsed}s ===`);
  console.log(`  Repos:            ${REPOS.length}`);
  console.log(`  Records ingested: ${totalRecords}`);
  console.log(`  Zones:            ${zones.length}`);
  console.log(`  Chunks indexed:   ${inserted}`);
  console.log(`  Types:            ${Object.entries(typeCounts).map(([t, c]) => `${t}=${c}`).join(', ')}`);

  blink.close();
}

main().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
