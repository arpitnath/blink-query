/**
 * Shared Ollama model configuration for all pathfinder agents.
 */

import type { Model } from '@mariozechner/pi-ai';

const modelId = process.env.OLLAMA_MODEL ?? 'ministral-3';

/** pi-ai model config for Ollama with Mistral-family compat flags. */
export const ollamaModel: Model<'openai-completions'> = {
  id: modelId,
  name: modelId,
  api: 'openai-completions',
  provider: 'ollama',
  baseUrl: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 256_000,
  maxTokens: 4096,
  compat: {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsUsageInStreaming: false,
    maxTokensField: 'max_tokens',
    requiresToolResultName: true,
    requiresMistralToolIds: true,
    supportsStrictMode: false,
  },
};

/** Ollama base URL for non-OpenAI-compat calls (/api/embed, /api/generate). */
export const OLLAMA_BASE = process.env.OLLAMA_BASE_URL_RAW ?? 'http://localhost:11434';

/** Embedding model for Ollama /api/embed. */
export const EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'nomic-embed-text';
