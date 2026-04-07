/**
 * Blink-first agent with learning cache pattern.
 *
 * Uses structured knowledge resolution (resolve → search → save) with
 * automatic answer caching for future instant lookups.
 *
 * Prerequisites:
 *   ollama pull ministral-3
 *   npm run ingest  (to populate the knowledge base)
 *
 * Run:
 *   npx tsx src/agent-blink.ts "Your question here"
 */

import { complete } from '@mariozechner/pi-ai';
import type { Context } from '@mariozechner/pi-ai';
import { Blink } from 'blink-query';
import { ollamaModel } from './model.js';
import { blinkTools, createBlinkExecutor } from './tools.js';

// --- Types ---

export interface BlinkAgentResult {
  answer: string;
  tool_calls: Array<{ name: string; args: Record<string, unknown> }>;
  timing: { resolve_ms: number; search_ms: number; llm_ms: number; total_ms: number };
}

// --- Constants ---

const MAX_TURNS = 10;
const BLINK_DB = process.env.BLINK_DB ?? './data/blink.db';

const SYSTEM_PROMPT = `You are a knowledge resolution agent backed by a structured knowledge base.

RESOLUTION STRATEGY (use in this order):
1. blink_zones — discover what namespaces exist (do this once at the start if unsure)
2. blink_resolve — when you know or can guess the path (e.g. "github/vercel/next-js/issues/bug/")
3. blink_search — keyword search when path is unknown
4. blink_save — save your synthesized answer as a SUMMARY for future queries

RECORD TYPE SEMANTICS:
- SUMMARY: Read directly. This IS the answer.
- META: Structured config/rules. Parse and apply.
- SOURCE: Has summary + pointer. Use the summary unless the user needs depth.
- ALIAS: Auto-followed. You will receive the target record.
- COLLECTION: Lists children. Pick the most relevant 1-2 to resolve next.

NXDOMAIN responses include "suggestions" — nearby paths that do exist. Use them to navigate.

LEARNING CACHE: After answering via blink_search, ALWAYS call blink_save to cache your answer.
Use namespace "cache/answers", set the title to the EXACT user question verbatim, and type SUMMARY.
This ensures the exact same question resolves instantly next time via cache/answers/<slug-of-question>.

Be concise. Stop when you have a confident answer.`;

// --- Main export ---

export async function askBlink(question: string, blink?: Blink): Promise<BlinkAgentResult> {
  const totalStart = Date.now();

  const ownedBlink = blink === undefined;
  const db = blink ?? new Blink({ dbPath: BLINK_DB });

  const executeTool = createBlinkExecutor(db);

  const context: Context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: question, timestamp: Date.now() }],
    tools: blinkTools,
  };

  const result: BlinkAgentResult = {
    answer: '',
    tool_calls: [],
    timing: { resolve_ms: 0, search_ms: 0, llm_ms: 0, total_ms: 0 },
  };

  let turns = 0;

  while (turns < MAX_TURNS) {
    turns++;

    const llmStart = Date.now();
    const response = await complete(ollamaModel, context, { apiKey: 'ollama' });
    result.timing.llm_ms += Date.now() - llmStart;

    context.messages.push(response);

    if (response.stopReason === 'error') {
      result.answer = response.errorMessage ?? 'Unknown error';
      break;
    }

    const toolCalls = response.content.filter(
      (b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall',
    );

    if (toolCalls.length === 0) {
      result.answer = response.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      break;
    }

    for (const call of toolCalls) {
      result.tool_calls.push({ name: call.name, args: call.arguments as Record<string, unknown> });

      const toolStart = Date.now();
      const toolResult = executeTool(call.name, call.arguments as Record<string, unknown>);
      const elapsed = Date.now() - toolStart;

      if (call.name === 'blink_resolve') {
        result.timing.resolve_ms += elapsed;
      } else if (call.name === 'blink_search') {
        result.timing.search_ms += elapsed;
      }

      context.messages.push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: toolResult }],
        isError: false,
        timestamp: Date.now(),
      });
    }
  }

  result.timing.total_ms = Date.now() - totalStart;

  if (ownedBlink) {
    db.close();
  }

  return result;
}

// --- Standalone runner ---

if (process.argv[1]?.endsWith('agent-blink.ts') || process.argv[1]?.endsWith('agent-blink.js')) {
  const question = process.argv[2] ?? 'What bug issues exist in this repo?';
  console.log(`Q: ${question}\n`);
  askBlink(question).then((r) => {
    console.log(`\nA: ${r.answer}`);
    console.log(`\nTools: ${r.tool_calls.map((t) => `${t.name}(${JSON.stringify(t.args)})`).join('\n       ')}`);
    console.log(
      `\nTiming: resolve=${r.timing.resolve_ms}ms search=${r.timing.search_ms}ms llm=${r.timing.llm_ms}ms total=${r.timing.total_ms}ms`,
    );
  }).catch(console.error);
}
