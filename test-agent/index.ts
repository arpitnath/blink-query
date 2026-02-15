/**
 * Blink MCP Test Agent
 *
 * Connects to Blink's MCP server via stdio transport using:
 * - MCP SDK's StdioClientTransport (spawns Blink as child process)
 * - Anthropic SDK's mcpTools helper (converts MCP tools to Claude API tools)
 * - Anthropic SDK's toolRunner (handles agentic tool-call loop automatically)
 *
 * Validates that Claude naturally discovers and uses Blink's typed records.
 */

import Anthropic from "@anthropic-ai/sdk";
import { mcpTools } from "@anthropic-ai/sdk/helpers/beta/mcp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY environment variable is required");
  process.exit(1);
}
const BUN_PATH = process.env.BUN_PATH || "bun";
const BLINK_ENTRY = process.env.BLINK_ENTRY || "./dist/index.js";

const SYSTEM_PROMPT = `You are a test agent validating Blink, a DNS-inspired knowledge resolution system.
You have access to Blink tools via MCP. Use them to answer user questions.

When you find records, pay attention to their TYPE — this is the core innovation:
- SUMMARY: Read the summary, you have what you need
- META: These are rules/config, follow them as instructions
- COLLECTION: Browse children, pick what's relevant
- SOURCE: Summary is here, fetch source if you need depth
- ALIAS: Follow the redirect to the target record

Always use the Blink tools to look up information rather than guessing.`;

// Test prompts that exercise different Blink capabilities
const TEST_PROMPTS = [
  // 1. Namespace browsing — should trigger blink_list or blink_resolve
  "What do you know about me? Check blink for my personal info.",

  // 2. Direct record resolve — should trigger blink_resolve
  "What are my coding preferences and conventions?",

  // 3. Keyword search — should trigger blink_search
  "Find my notes about authentication and JWT patterns.",

  // 4. Query DSL — should trigger blink_query
  "Search blink for all discoveries tagged with 'architecture'.",

  // 5. Save new knowledge — should trigger blink_save
  "Save this to blink under discoveries: I learned that Blink's MCP integration works via stdio transport. Title it 'MCP Stdio Integration'. Tag it with 'mcp' and 'blink'.",
];

async function connectBlink(): Promise<Client> {
  console.log("Connecting to Blink MCP server via stdio...");
  console.log(`  Command: ${BUN_PATH} ${BLINK_ENTRY} serve\n`);

  const transport = new StdioClientTransport({
    command: BUN_PATH,
    args: [BLINK_ENTRY, "serve"],
  });

  const mcpClient = new Client({
    name: "blink-test-agent",
    version: "1.0.0",
  });

  await mcpClient.connect(transport);
  return mcpClient;
}

async function listAvailableTools(mcpClient: Client): Promise<void> {
  const { tools } = await mcpClient.listTools();
  console.log(`Found ${tools.length} Blink tools:`);
  for (const tool of tools) {
    console.log(`  - ${tool.name}: ${tool.description?.slice(0, 80)}...`);
  }
  console.log();
}

async function runTest(
  anthropic: Anthropic,
  mcpClient: Client,
  prompt: string,
  testNumber: number
): Promise<void> {
  console.log("=".repeat(60));
  console.log(`TEST ${testNumber}: ${prompt.slice(0, 70)}...`);
  console.log("=".repeat(60));

  const { tools } = await mcpClient.listTools();

  // toolRunner handles the full agentic loop:
  // user message → Claude response → tool calls → tool results → Claude response → ...
  const runner = anthropic.beta.messages.toolRunner({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    tools: mcpTools(tools, mcpClient),
    max_iterations: 5,
  });

  // Stream through the agentic loop, logging each step
  for await (const event of runner) {
    if ('content' in event) {
      // This is a BetaMessage
      const msg = event as Anthropic.Beta.Messages.BetaMessage;
      for (const block of msg.content) {
        if (block.type === "text") {
          // Don't print yet — we'll print the final message
        } else if (block.type === "tool_use") {
          console.log(`\n  [Tool Call] ${block.name}(${JSON.stringify(block.input)})`);
        }
      }
      if (msg.stop_reason === "tool_use") {
        console.log("  [Executing tools and continuing...]");
      }
    }
  }

  // Get the final response
  const finalMessage = await runner.done();

  console.log("\nFinal Response:");
  console.log("-".repeat(40));
  for (const block of finalMessage.content) {
    if (block.type === "text") {
      console.log(block.text);
    } else if (block.type === "tool_use") {
      console.log(`  [Tool: ${block.name}] Input: ${JSON.stringify(block.input)}`);
    }
  }
  console.log("-".repeat(40));
  console.log(`Stop reason: ${finalMessage.stop_reason}`);
  console.log(`Tokens: ${finalMessage.usage.input_tokens} in / ${finalMessage.usage.output_tokens} out\n`);
}

async function main() {
  console.log("\n" + "=".repeat(60));
  console.log("  BLINK MCP TEST AGENT");
  console.log("  Validates Blink + Claude via stdio MCP transport");
  console.log("=".repeat(60) + "\n");

  // 1. Connect to Blink
  const mcpClient = await connectBlink();

  // 2. List available tools
  await listAvailableTools(mcpClient);

  // 3. Initialize Anthropic client
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  // 4. Run specific test or all tests
  const testIndex = process.argv[2] ? parseInt(process.argv[2]) - 1 : -1;
  const prompts = testIndex >= 0 && testIndex < TEST_PROMPTS.length
    ? [TEST_PROMPTS[testIndex]]
    : TEST_PROMPTS;

  const startIndex = testIndex >= 0 ? testIndex + 1 : 1;

  for (let i = 0; i < prompts.length; i++) {
    try {
      await runTest(anthropic, mcpClient, prompts[i], startIndex + i);
    } catch (error) {
      console.error(`\nTest ${startIndex + i} FAILED:`, error);
    }
  }

  // 5. Cleanup
  console.log("\n" + "=".repeat(60));
  console.log("  ALL TESTS COMPLETE");
  console.log("=".repeat(60) + "\n");

  await mcpClient.close();
  process.exit(0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
