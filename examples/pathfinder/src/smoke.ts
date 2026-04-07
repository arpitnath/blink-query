/**
 * Smoke test: Validate that Ollama + pi-ai + tool calling works.
 *
 * Prerequisites:
 *   ollama pull ministral-3
 *   npm install
 *
 * Run:
 *   npm run smoke
 */

import { Type, complete } from '@mariozechner/pi-ai';
import type { Tool, Context, Model } from '@mariozechner/pi-ai';

// --- Setup Ollama as an OpenAI-compatible model ---

const modelId = process.env.OLLAMA_MODEL || 'mistral';

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

// --- Define two simple tools ---

const tools: Tool[] = [
  {
    name: 'add',
    description: 'Add two numbers together and return the sum',
    parameters: Type.Object({
      a: Type.Number({ description: 'First number' }),
      b: Type.Number({ description: 'Second number' }),
    }),
  },
  {
    name: 'lookup_capital',
    description: 'Look up the capital city of a country',
    parameters: Type.Object({
      country: Type.String({ description: 'Country name' }),
    }),
  },
];

// --- Tool executor ---

function executeTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'add':
      return String((args.a as number) + (args.b as number));
    case 'lookup_capital': {
      const capitals: Record<string, string> = {
        france: 'Paris',
        japan: 'Tokyo',
        brazil: 'Brasília',
        india: 'New Delhi',
        australia: 'Canberra',
      };
      const country = (args.country as string).toLowerCase();
      return capitals[country] || `Unknown capital for ${args.country}`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

// --- Agentic loop ---

async function run() {
  console.log('=== Pathfinder Smoke Test ===\n');
  console.log(`Model: ${model.id} via Ollama (${model.baseUrl})`);
  console.log(`Tools: ${tools.map((t) => t.name).join(', ')}`);
  console.log(`Tip: OLLAMA_MODEL=ministral-3 npm run smoke\n`);

  const questions = [
    'What is 42 + 58?',
    'What is the capital of Japan?',
    'Add 1337 and 7331, then tell me the capital of India.',
  ];

  for (const question of questions) {
    console.log(`\n--- Question: "${question}" ---\n`);

    const context: Context = {
      systemPrompt:
        'You are a helpful assistant. Use the provided tools to answer questions accurately. Always use tools when they are relevant — do not guess or calculate manually.',
      messages: [{ role: 'user', content: question, timestamp: Date.now() }],
      tools,
    };

    let turns = 0;
    const maxTurns = 5;

    while (turns < maxTurns) {
      turns++;
      const response = await complete(model, context, { apiKey: 'ollama' });
      context.messages.push(response);

      // Extract tool calls
      const toolCalls = response.content.filter(
        (b): b is Extract<typeof b, { type: 'toolCall' }> => b.type === 'toolCall',
      );

      // If no tool calls, we have the final answer
      if (toolCalls.length === 0) {
        const text = response.content
          .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
          .map((b) => b.text)
          .join('');
        console.log(`Answer: ${text}`);
        console.log(
          `Turns: ${turns} | Tokens: ${response.usage.input} in, ${response.usage.output} out`,
        );
        break;
      }

      // Execute tool calls
      for (const call of toolCalls) {
        console.log(`  → Tool: ${call.name}(${JSON.stringify(call.arguments)})`);
        const result = executeTool(call.name, call.arguments);
        console.log(`  ← Result: ${result}`);

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
      console.log(`  ⚠ Hit max turns (${maxTurns}) without final answer`);
    }
  }

  console.log('\n=== Smoke test complete ===');
}

run().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
