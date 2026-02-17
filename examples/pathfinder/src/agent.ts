/**
 * Pathfinder Agent: Tests blink-query tools with a real LLM.
 *
 * Seeds blink with sample knowledge, then asks the agent questions
 * that require resolving, searching, and browsing.
 *
 * Prerequisites:
 *   ollama pull ministral-3
 *   npm install
 *
 * Run:
 *   npm run agent
 */

import { complete } from '@mariozechner/pi-ai';
import type { Context, Model } from '@mariozechner/pi-ai';
import { Blink } from 'blink-query';
import { blinkTools, createBlinkExecutor } from './tools.js';

// --- Setup ---

const modelId = process.env.OLLAMA_MODEL || 'ministral-3';

const model: Model<'openai-completions'> = {
  id: modelId,
  name: modelId,
  api: 'openai-completions',
  provider: 'ollama',
  baseUrl: 'http://localhost:11434/v1',
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

// --- Seed blink with sample knowledge ---

function seedKnowledge(blink: Blink) {
  console.log('Seeding knowledge...\n');

  // Support domain
  blink.save({
    namespace: 'support/billing',
    title: 'Refund Policy',
    type: 'SUMMARY',
    summary:
      'Full refunds within 30 days, no questions asked. After 30 days, pro-rated credit only. Enterprise contracts follow custom terms defined in their SLA.',
    tags: ['billing', 'refunds', 'policy'],
  });

  blink.save({
    namespace: 'support/billing',
    title: 'Discount Rules',
    type: 'META',
    summary: 'Discount constraints for the sales team',
    content: { maxDiscount: 20, requiresManagerApproval: true, enterpriseFloor: 15 },
    tags: ['billing', 'pricing', 'discounts'],
  });

  blink.save({
    namespace: 'support/billing',
    title: 'Enterprise Pricing Guide',
    type: 'SOURCE',
    summary:
      '47-page pricing guide covering volume tiers, custom SLAs, and multi-year terms. Last updated January 2026.',
    content: { url: 'https://internal.docs/pricing-guide-v3.pdf' },
    tags: ['billing', 'enterprise', 'pricing'],
  });

  // Alias: cancellation → refund policy
  blink.save({
    namespace: 'support',
    title: 'Cancellation Policy',
    type: 'ALIAS',
    content: { target: 'support/billing/refund-policy' },
    tags: ['billing', 'cancellation'],
  });

  // Product domain
  blink.save({
    namespace: 'product/auth',
    title: 'Session Handling',
    type: 'SUMMARY',
    summary:
      'Sessions use JWT stored in httpOnly cookies. Refresh tokens rotate on each use. Access token expiry: 15 minutes. Refresh token expiry: 7 days. MFA required for admin roles.',
    tags: ['auth', 'jwt', 'sessions', 'security'],
  });

  blink.save({
    namespace: 'product/auth',
    title: 'Rate Limiting Rules',
    type: 'META',
    summary: 'API rate limiting configuration',
    content: {
      loginAttempts: { max: 5, windowMinutes: 15, lockoutMinutes: 30 },
      apiCalls: { max: 1000, windowMinutes: 60 },
      passwordReset: { max: 3, windowMinutes: 60 },
    },
    tags: ['auth', 'security', 'rate-limiting'],
  });

  blink.save({
    namespace: 'product/features',
    title: 'Dark Mode Implementation',
    type: 'SOURCE',
    summary:
      'Dark mode uses CSS custom properties with a theme provider. Supports system preference detection and manual toggle. 3 themes: light, dark, auto.',
    content: { url: 'src/theme/ThemeProvider.tsx' },
    tags: ['frontend', 'ui', 'dark-mode'],
  });

  // Engineering domain
  blink.save({
    namespace: 'engineering/incidents',
    title: 'Database Migration Outage Jan 2026',
    type: 'SUMMARY',
    summary:
      'PostgreSQL migration to v16 caused 23-minute outage on Jan 15. Root cause: missing index on users.email column after migration. Fix: added index, added migration checklist step for index verification.',
    tags: ['incident', 'database', 'postmortem'],
  });

  blink.save({
    namespace: 'engineering/decisions',
    title: 'Why We Chose SQLite Over DynamoDB',
    type: 'SUMMARY',
    summary:
      'Evaluated DynamoDB, PostgreSQL, and SQLite for the knowledge store. Chose SQLite: zero infrastructure, sub-millisecond reads, single-file deployment. Trade-off: single-writer limitation acceptable for our write volume (~100 writes/minute).',
    tags: ['architecture', 'database', 'adr'],
  });

  console.log(`  Seeded ${blink.zones().reduce((sum, z) => sum + z.record_count, 0)} records across ${blink.zones().length} zones\n`);
}

// --- Agentic loop ---

async function askAgent(blink: Blink, question: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Q: ${question}`);
  console.log('='.repeat(60));

  const executeTool = createBlinkExecutor(blink);

  const context: Context = {
    systemPrompt: `You are a knowledge assistant. You have access to a structured knowledge base via blink tools.

IMPORTANT RULES:
- ALWAYS use blink_resolve when you know or can guess the path to a record
- Use blink_search when you don't know the exact path
- Use blink_list to explore what exists in a namespace
- When you get a record back, pay attention to its TYPE:
  - SUMMARY: Read it directly, it has the answer
  - META: Contains structured rules/config, parse and apply them
  - SOURCE: Has a summary + pointer to full content, fetch if the user needs depth
  - ALIAS: Automatically follows to the real record
  - COLLECTION: Lists children, pick what's relevant
- Be concise in your answers`,
    messages: [{ role: 'user', content: question, timestamp: Date.now() }],
    tools: blinkTools,
  };

  let turns = 0;
  const maxTurns = 8;

  while (turns < maxTurns) {
    turns++;
    const response = await complete(model, context, { apiKey: 'ollama' });
    context.messages.push(response);

    if (response.stopReason === 'error') {
      console.log(`\n  ERROR: ${response.errorMessage}`);
      break;
    }

    const toolCalls = response.content.filter(
      (b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall',
    );

    if (toolCalls.length === 0) {
      const text = response.content
        .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text)
        .join('');
      console.log(`\nA: ${text}`);
      console.log(`\n  [${turns} turns]`);
      break;
    }

    for (const call of toolCalls) {
      console.log(`  → ${call.name}(${JSON.stringify(call.arguments)})`);
      const result = executeTool(call.name, call.arguments);
      const preview = result.length > 200 ? result.substring(0, 200) + '...' : result;
      console.log(`  ← ${preview}`);

      context.messages.push({
        role: 'toolResult',
        toolCallId: call.id,
        toolName: call.name,
        content: [{ type: 'text', text: result }],
        isError: false,
        timestamp: Date.now(),
      });
    }
  }

  if (turns >= maxTurns) {
    console.log(`\n  ⚠ Hit max turns (${maxTurns})`);
  }
}

// --- Main ---

async function main() {
  console.log('=== Pathfinder Agent ===\n');
  console.log(`Model: ${model.id} via Ollama`);
  console.log(`Tools: ${blinkTools.map((t) => t.name).join(', ')}\n`);

  // In-memory blink instance for testing
  const blink = new Blink();
  seedKnowledge(blink);

  const questions = [
    // Direct resolution
    'What is our refund policy?',

    // Alias following
    'What is the cancellation policy?',

    // Namespace browsing
    'What billing-related knowledge do we have?',

    // Search
    'Tell me about the database outage',

    // META type — should parse structured data
    'What are the rate limiting rules for login attempts?',

    // Cross-domain question requiring search
    'What architectural decisions have been documented?',
  ];

  for (const q of questions) {
    await askAgent(blink, q);
  }

  blink.close();
  console.log('\n=== Done ===');
}

main().catch((err) => {
  console.error('Agent failed:', err);
  process.exit(1);
});
