/**
 * Thin RAG wrapper agent.
 *
 * No tools, no agentic loop — delegates directly to RAGEngine
 * which handles retrieval and generation internally.
 *
 * Prerequisites:
 *   ollama pull ministral-3
 *   ollama pull nomic-embed-text
 *   npm run ingest  (to populate the knowledge base)
 *
 * Run:
 *   npx tsx src/agent-rag.ts "Your question here"
 */

import { RAGEngine } from './rag.js';
import type { RAGResult } from './rag.js';

// Module-level engine — reused across calls to avoid repeated init.
const rag = new RAGEngine();

// --- Main export ---

export async function askRAG(question: string): Promise<RAGResult> {
  return rag.answer(question);
}

// --- Standalone runner ---

if (process.argv[1]?.endsWith('agent-rag.ts') || process.argv[1]?.endsWith('agent-rag.js')) {
  const question = process.argv[2] ?? 'What bug issues exist in this repo?';
  console.log(`Q: ${question}\n`);
  askRAG(question).then((r) => {
    console.log(`A: ${r.answer}`);
    console.log(`Sources: ${r.sources.join(', ')}`);
    console.log(`Timing: retrieval=${r.timing.retrieval_ms}ms llm=${r.timing.llm_ms}ms total=${r.timing.total_ms}ms`);
  }).catch(console.error);
}
