/**
 * Pathfinder ingest pipeline.
 *
 * Phase 1 — Blink: fetch GitHub issues and save as knowledge records in blink.db
 * Phase 2 — Vectra: read all records, chunk title+summary, embed via Ollama, build vector index
 *
 * Config (env vars):
 *   REPO         GitHub repo in owner/repo format (default: vercel/next.js)
 *   MAX_PAGES    pages to fetch from GitHub API (default: 5)
 *   BLINK_DB     SQLite file path (default: ./data/blink.db)
 *   VECTRA_DIR   Vectra index directory (default: ./data/vectra-index)
 *
 * Run:
 *   npm run ingest
 *   REPO=facebook/react MAX_PAGES=3 npm run ingest
 */

import { mkdirSync } from 'fs';
import { Blink, GITHUB_DERIVERS, extractiveSummarize } from 'blink-query';
import { LocalIndex } from 'vectra';
import { OLLAMA_BASE, EMBED_MODEL } from './model.js';

// --- Config ---

const REPO = process.env.REPO ?? 'vercel/next.js';
const MAX_PAGES = parseInt(process.env.MAX_PAGES ?? '5', 10);
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

// --- Main ---

async function main() {
  const startTime = Date.now();

  mkdirSync('./data', { recursive: true });

  console.log('=== Pathfinder Ingest ===');
  console.log(`Repo:      ${REPO}`);
  console.log(`Max pages: ${MAX_PAGES}`);
  console.log(`Blink DB:  ${BLINK_DB}`);
  console.log(`Vectra:    ${VECTRA_DIR}\n`);

  // ─── Phase 1: Blink ingest ────────────────────────────────

  console.log('Phase 1: Ingesting GitHub issues into Blink...');

  const blink = new Blink({ dbPath: BLINK_DB });

  const result = await blink.ingestFromGitHub(
    { repo: REPO, maxPages: MAX_PAGES, state: 'all' },
    {
      ...GITHUB_DERIVERS,
      summarize: extractiveSummarize(500),
      onBatchComplete: ({ processed, total }) => {
        process.stdout.write(`\r  Processed ${processed}/${total} issues...`);
      },
    },
  );

  console.log(`\nPhase 1 done: ${result.records.length} records saved (${result.elapsed}ms)\n`);

  // ─── Phase 2: Vectra vector index ────────────────────────

  console.log('Phase 2: Building Vectra vector index...');

  const index = new LocalIndex(VECTRA_DIR);
  await index.createIndex({ version: 1, deleteIfExists: true });

  // Gather all records from every zone
  const zones = blink.zones();
  const allRecords = zones.flatMap((z) => blink.list(z.path, 'recent', { limit: 5000 }));
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
  console.log(`  Records ingested: ${result.records.length}`);
  console.log(`  Chunks indexed:   ${inserted}`);

  blink.close();
}

main().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});
