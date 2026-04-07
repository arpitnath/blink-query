/**
 * Blink pipeline — structurally equivalent to RAG for fair comparison.
 *
 * Both systems: retrieve → generate. Blink adds a cache layer on top.
 * No agentic loop, no multi-turn tool calling — just a pipeline.
 */

import { Blink } from 'blink-query';
import { OLLAMA_BASE } from './model.js';

const BLINK_DB = process.env.BLINK_DB ?? './data/blink.db';

export interface BlinkPipelineResult {
  answer: string;
  sources: string[];
  cache_hit: boolean;
  record_type: string | null;
  timing: { retrieval_ms: number; llm_ms: number; total_ms: number };
}

/** Generate an answer via Ollama /api/generate (same as RAG agent). */
async function generate(question: string, context: string): Promise<{ answer: string; time_ms: number }> {
  const t0 = Date.now();
  const prompt = `Answer the question based on the context below. Be concise.\n\nContext:\n${context}\n\nQuestion: ${question}\nAnswer:`;

  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL ?? 'ministral-3',
      prompt,
      stream: false,
    }),
  });
  if (!res.ok) throw new Error(`Ollama generate error: ${res.status} ${res.statusText}`);
  const data = (await res.json()) as { response: string };
  return { answer: data.response.trim(), time_ms: Date.now() - t0 };
}

/**
 * Blink pipeline: cache check → search → generate → cache save.
 * Structurally equivalent to RAG's: embed → search → generate.
 */
export async function askBlinkPipeline(question: string, blink?: Blink): Promise<BlinkPipelineResult> {
  const t0 = Date.now();
  const ownBlink = !blink;
  const db = blink ?? new Blink({ dbPath: BLINK_DB });

  // Step 1: Check cache — deterministic path from question
  const cachePath = db.pathFor('cache/answers', question);
  const rt0 = Date.now();
  const cached = db.resolve(cachePath);

  if (cached.status === 'OK' && cached.record) {
    const retrieval_ms = Date.now() - rt0;
    if (ownBlink) db.close();
    return {
      answer: cached.record.summary ?? '',
      sources: [cached.record.path],
      cache_hit: true,
      record_type: cached.record.type,
      timing: { retrieval_ms, llm_ms: 0, total_ms: Date.now() - t0 },
    };
  }

  // Step 2: Search by keywords (BM25)
  const results = db.search(question, { limit: 3 });
  const retrieval_ms = Date.now() - rt0;

  // Step 3: Build context from search results (typed — use summaries, not raw chunks)
  const contextParts = results.map((r, i) => {
    const typeHint = r.type === 'SUMMARY' ? '(verified answer)' : r.type === 'SOURCE' ? '(reference)' : `(${r.type})`;
    return `[${i + 1}] ${typeHint} ${r.title}\n${r.summary ?? ''}`;
  });
  const context = contextParts.join('\n\n');

  // Step 4: Generate answer (same LLM call as RAG)
  const gen = await generate(question, context);

  // Step 5: Cache the answer for next time
  db.save({
    namespace: 'cache/answers',
    title: question,
    type: 'SUMMARY',
    summary: gen.answer,
    tags: ['cache', 'auto-generated'],
  });

  if (ownBlink) db.close();

  return {
    answer: gen.answer,
    sources: results.map((r) => r.path),
    cache_hit: false,
    record_type: results[0]?.type ?? null,
    timing: { retrieval_ms, llm_ms: gen.time_ms, total_ms: Date.now() - t0 },
  };
}

// --- Standalone runner ---

if (process.argv[1]?.endsWith('pipeline-blink.ts') || process.argv[1]?.endsWith('pipeline-blink.js')) {
  const question = process.argv[2] ?? 'What turbopack issues exist?';
  console.log(`Q: ${question}\n`);
  askBlinkPipeline(question).then((r) => {
    console.log(`A: ${r.answer}`);
    console.log(`\nCache hit: ${r.cache_hit}`);
    console.log(`Record type: ${r.record_type}`);
    console.log(`Sources: ${r.sources.join(', ')}`);
    console.log(`Timing: retrieval=${r.timing.retrieval_ms}ms llm=${r.timing.llm_ms}ms total=${r.timing.total_ms}ms`);
  }).catch(console.error);
}
