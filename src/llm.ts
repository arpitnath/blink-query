import type { LLMConfig, SummarizeCallback, ClassifyCallback, RecordType } from './types.js';
import { extractiveSummarize } from './ingest.js';

// ─── Defaults ────────────────────────────────────────────────

const DEFAULT_PROVIDER = 'openai' as const;
const DEFAULT_MODEL = 'gpt-5-mini-2025-08-07';
const DEFAULT_MAX_INPUT_CHARS = 8000;
const DEFAULT_TEMPERATURE = 0.3;

const DEFAULT_SUMMARIZE_PROMPT =
  'Summarize the following document concisely. Focus on key facts, decisions, and actionable information. Keep the summary under 200 words.';

const DEFAULT_CLASSIFY_PROMPT =
  'Classify this document into exactly one type: SUMMARY (self-contained knowledge), META (structured data/config), or SOURCE (reference material needing full fetch). Respond with just the type name.';

const VALID_RECORD_TYPES = new Set<string>(['SUMMARY', 'META', 'COLLECTION', 'SOURCE', 'ALIAS']);

// ─── Config resolution ───────────────────────────────────────

interface ResolvedConfig {
  provider: 'openai';
  model: string;
  apiKey: string;
  maxInputChars: number;
  temperature: number;
}

function resolveConfig(config?: LLMConfig, requireKey = true): ResolvedConfig {
  const provider = config?.provider || (process.env.BLINK_LLM_PROVIDER as 'openai') || DEFAULT_PROVIDER;
  const model = config?.model || process.env.BLINK_LLM_MODEL || DEFAULT_MODEL;
  const maxInputChars = config?.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  const temperature = config?.temperature ?? DEFAULT_TEMPERATURE;

  let apiKey = config?.apiKey || '';

  if (provider === 'openai') {
    apiKey = apiKey || process.env.OPENAI_API_KEY || '';
    if (requireKey && !apiKey) {
      throw new Error('OPENAI_API_KEY required: set env var or pass apiKey in config');
    }
  }

  return { provider, model, apiKey, maxInputChars, temperature };
}

// ─── OpenAI chat completion via fetch ────────────────────────

interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

async function openaiChat(
  resolved: ResolvedConfig,
  messages: ChatMessage[],
): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${resolved.apiKey}`,
    },
    body: JSON.stringify({
      model: resolved.model,
      messages,
      temperature: resolved.temperature,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices[0]?.message?.content?.trim() || '';
}

// ─── Factory: LLM summarizer ────────────────────────────────

/**
 * Creates a `SummarizeCallback` powered by an LLM API.
 *
 * Configuration is resolved from the provided config object,
 * then from environment variables, then from defaults:
 * - `BLINK_LLM_PROVIDER` (default: 'openai')
 * - `BLINK_LLM_MODEL`    (default: 'gpt-5-mini-2025-08-07')
 * - `OPENAI_API_KEY`      (required when provider is openai)
 */
export function llmSummarize(config?: LLMConfig): SummarizeCallback {
  const resolved = resolveConfig(config);
  const systemPrompt = config?.systemPrompt || DEFAULT_SUMMARIZE_PROMPT;
  const fallback = extractiveSummarize(500);

  return async (text: string, metadata: Record<string, unknown>): Promise<string> => {
    const truncated = text.slice(0, resolved.maxInputChars);

    try {
      return await openaiChat(resolved, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: truncated },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[blink] LLM summarize failed, falling back to extractive: ${message}\n`);
      return fallback(text, metadata);
    }
  };
}

// ─── Factory: LLM classifier ────────────────────────────────

/**
 * Creates a `ClassifyCallback` powered by an LLM API.
 *
 * Same configuration resolution as `llmSummarize`.
 * Returns a valid `RecordType` or defaults to `'SOURCE'`.
 */
export function llmClassify(config?: LLMConfig): ClassifyCallback {
  const resolved = resolveConfig(config);
  const systemPrompt = config?.systemPrompt || DEFAULT_CLASSIFY_PROMPT;

  return async (text: string, _metadata: Record<string, unknown>): Promise<RecordType> => {
    const truncated = text.slice(0, resolved.maxInputChars);

    try {
      const raw = await openaiChat(resolved, [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: truncated },
      ]);

      const normalized = raw.toUpperCase().trim();
      if (VALID_RECORD_TYPES.has(normalized)) {
        return normalized as RecordType;
      }
      return 'SOURCE';
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[blink] LLM classify failed, defaulting to SOURCE: ${message}\n`);
      return 'SOURCE';
    }
  };
}
