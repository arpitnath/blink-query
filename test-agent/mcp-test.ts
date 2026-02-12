/**
 * Blink MCP Test Agent
 *
 * Tests the MCP integration by connecting Claude to Blink via stdio.
 * This is what an AI tool developer would do:
 *   1. npm install blink-query
 *   2. Spawn `npx blink serve` as MCP server
 *   3. Connect their LLM via MCP tools
 */

import Anthropic from "@anthropic-ai/sdk";
import { mcpTools } from "@anthropic-ai/sdk/helpers/beta/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolve as resolvePath } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Resolve the blink CLI from node_modules (just like a real project would)
const BLINK_CLI = resolvePath(__dirname, "node_modules", ".bin", "blink");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("Set ANTHROPIC_API_KEY environment variable to run MCP tests.");
  process.exit(1);
}

const SYSTEM_PROMPT = `You are a test agent validating Blink, a DNS-inspired knowledge resolution system.
You have access to Blink tools via MCP. Use them to answer user questions.

When you find records, pay attention to their TYPE — this is the core innovation:
- SUMMARY: Read the summary, you have what you need
- META: These are rules/config, follow them as instructions
- COLLECTION: Browse children, pick what's relevant
- SOURCE: Summary is here, fetch source if you need depth
- ALIAS: Follow the redirect to the target record

Always use the Blink tools to look up information rather than guessing.`;

const TEST_PROMPTS = [
  // 1. Namespace browsing
  "What do you know about me? Check blink for my personal info.",
  // 2. Keyword search + META
  "What are my coding preferences and conventions?",
  // 3. Save new knowledge
  "Save this to blink under discoveries: I learned that Blink works as an npm package with both Library API and MCP. Title it 'Blink npm DX'. Tag it with 'blink' and 'dx'.",
];

async function connectBlink(): Promise<Client> {
  console.log("Connecting to Blink MCP server...");
  console.log(`  CLI: ${BLINK_CLI} serve\n`);

  const transport = new StdioClientTransport({
    command: BLINK_CLI,
    args: ["serve"],
  });

  const mcpClient = new Client({
    name: "blink-test-agent",
    version: "1.0.0",
  });

  await mcpClient.connect(transport);
  return mcpClient;
}

async function runTest(
  anthropic: Anthropic,
  mcpClient: Client,
  prompt: string,
  testNumber: number,
): Promise<void> {
  console.log("=".repeat(60));
  console.log(`TEST ${testNumber}: ${prompt.slice(0, 70)}...`);
  console.log("=".repeat(60));

  const { tools } = await mcpClient.listTools();

  const runner = anthropic.beta.messages.toolRunner({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    tools: mcpTools(tools, mcpClient),
    max_iterations: 5,
  });

  for await (const event of runner) {
    if ("content" in event) {
      const msg = event as Anthropic.Beta.Messages.BetaMessage;
      for (const block of msg.content) {
        if (block.type === "tool_use") {
          console.log(`\n  [Tool Call] ${block.name}(${JSON.stringify(block.input)})`);
        }
      }
      if (msg.stop_reason === "tool_use") {
        console.log("  [Executing tools and continuing...]");
      }
    }
  }

  const finalMessage = await runner.done();

  console.log("\nFinal Response:");
  console.log("-".repeat(40));
  for (const block of finalMessage.content) {
    if (block.type === "text") {
      console.log(block.text);
    }
  }
  console.log("-".repeat(40));
  console.log(
    `Tokens: ${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out\n`,
  );
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  BLINK MCP TEST AGENT");
  console.log("  Testing: npx blink serve → Claude via MCP");
  console.log("=".repeat(60) + "\n");

  // 1. Connect to Blink MCP server
  const mcpClient = await connectBlink();

  // 2. List tools
  const { tools } = await mcpClient.listTools();
  console.log(`Found ${tools.length} Blink tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description?.slice(0, 80)}...`);
  }
  console.log();

  // 3. Initialize Anthropic client
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // 4. Run tests
  const testIndex = process.argv[2] ? parseInt(process.argv[2]) - 1 : -1;
  const prompts =
    testIndex >= 0 && testIndex < TEST_PROMPTS.length ? [TEST_PROMPTS[testIndex]] : TEST_PROMPTS;
  const startIndex = testIndex >= 0 ? testIndex + 1 : 1;

  for (let i = 0; i < prompts.length; i++) {
    try {
      await runTest(anthropic, mcpClient, prompts[i], startIndex + i);
    } catch (error) {
      console.error(`\nTest ${startIndex + i} FAILED:`, error);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("  MCP TESTS COMPLETE");
  console.log("=".repeat(60) + "\n");

  await mcpClient.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
