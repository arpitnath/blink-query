---
title: "MCP TypeScript SDK — Building Servers"
source_url: https://github.com/modelcontextprotocol/typescript-sdk
date: 2025-01-20
type: SOURCE
---

# MCP TypeScript SDK

The official TypeScript SDK for building MCP clients and servers. Package:
`@modelcontextprotocol/sdk`

## Installation

```bash
npm install @modelcontextprotocol/sdk
```

## Building a minimal server

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "my-server",
  version: "1.0.0",
});

// Register a tool
server.tool(
  "add",
  "Add two numbers",
  { a: z.number(), b: z.number() },
  async ({ a, b }) => ({
    content: [{ type: "text", text: String(a + b) }],
  })
);

// Register a resource
server.resource(
  "config",
  "config://app",
  async (uri) => ({
    contents: [{ uri: uri.href, text: JSON.stringify({ theme: "dark" }) }],
  })
);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
```

## Low-level vs high-level API

The SDK provides two levels:

**High-level** (`McpServer`): Handles protocol boilerplate. Use for most servers.

**Low-level** (`Server`): Full control over request/response. Use when you need
custom capability negotiation or non-standard extensions.

```typescript
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

const server = new Server(
  { name: "low-level", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "my-tool", description: "...", inputSchema: { type: "object" } }],
}));
```

## Zod integration

The high-level API uses Zod for input validation. Tool arguments are automatically
validated against the schema before the handler is called.

## Transport options

```typescript
// stdio (local)
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

// SSE (HTTP, v1)
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

// Streamable HTTP (v2)
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
```

## Version

SDK version tracks the MCP spec version. Always use the latest for new servers.
