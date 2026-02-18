/**
 * Pure TypeScript RAG engine — no LangChain.
 *
 * Uses Vectra for vector similarity search and Ollama for LLM generation.
 * Designed for use as a standalone module or as a tool backend for agents.
 *
 * Prerequisites:
 *   ollama pull nomic-embed-text
 *   ollama pull ministral-3
 *   npm run ingest (to build the index first)
 */

import { LocalIndex } from 'vectra';
import { OLLAMA_BASE, EMBED_MODEL } from './model.js';

// --- Types ---

export interface RAGResult {
  answer: string;
  sources: string[];
  timing: { retrieval_ms: number; llm_ms: number; total_ms: number };
}

// --- RAG Engine ---

export class RAGEngine {
  private index: LocalIndex;

  constructor(vectraDir = './data/vectra-index') {
    this.index = new LocalIndex(vectraDir);
  }

  /** Embed a single text string via Ollama /api/embed. */
  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${OLLAMA_BASE}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, input: [text] }),
    });
    if (!res.ok) throw new Error(`Ollama embed error: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { embeddings: number[][] };
    return data.embeddings[0];
  }

  /** Embed query, search Vectra, return top chunks + source paths. */
  async retrieve(
    question: string,
    topK = 3,
  ): Promise<{ chunks: string[]; sources: string[]; time_ms: number }> {
    const t0 = Date.now();
    const vector = await this.embed(question);
    const results = await this.index.queryItems(vector, question, topK);
    const chunks = results.map((r) => r.item.metadata['chunk'] as string);
    const sources = [...new Set(results.map((r) => r.item.metadata['path'] as string))];
    return { chunks, sources, time_ms: Date.now() - t0 };
  }

  /** Stuff retrieved chunks into a prompt and call Ollama /api/generate. */
  async generate(
    question: string,
    chunks: string[],
  ): Promise<{ answer: string; time_ms: number }> {
    const t0 = Date.now();
    const context = chunks.map((c, i) => `[${i + 1}] ${c}`).join('\n\n');
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
    return { answer: data.response, time_ms: Date.now() - t0 };
  }

  /** Full RAG pipeline: retrieve relevant chunks then generate an answer. */
  async answer(question: string): Promise<RAGResult> {
    const t0 = Date.now();
    const { chunks, sources, time_ms: retrieval_ms } = await this.retrieve(question);
    const { answer, time_ms: llm_ms } = await this.generate(question, chunks);
    return {
      answer,
      sources,
      timing: { retrieval_ms, llm_ms, total_ms: Date.now() - t0 },
    };
  }
}
