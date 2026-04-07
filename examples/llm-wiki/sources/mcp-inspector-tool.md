---
title: "MCP Inspector — Browser-Based Debugging Tool"
source_url: https://github.com/modelcontextprotocol/inspector
date: 2024-11-25
type: SUMMARY
---

# MCP Inspector

The MCP Inspector is an interactive debugging tool for MCP server development. It provides
a browser-based UI to connect to, explore, and test MCP servers without needing a full
host application like Claude Desktop.

## Purpose

When building an MCP server, you need to test it before connecting it to Claude Desktop.
The Inspector lets you:

1. Connect to your server (stdio or SSE)
2. See what tools/resources/prompts it exposes
3. Call tools interactively and inspect results
4. View all JSON-RPC messages in a log

## Usage

```bash
# Start Inspector (connects to a server via stdin)
npx @modelcontextprotocol/inspector <command> [args]

# Example: inspect the filesystem server
npx @modelcontextprotocol/inspector npx @modelcontextprotocol/server-filesystem /tmp

# SSE server
npx @modelcontextprotocol/inspector --sse http://localhost:3000/sse
```

Opens a browser at `http://localhost:5173` with the Inspector UI.

## UI features

- **Capabilities tab**: Shows the server's declared capabilities
- **Tools tab**: Lists all tools, lets you invoke them with custom inputs (JSON form)
- **Resources tab**: Lists resources, lets you read them
- **Prompts tab**: Lists prompts, lets you expand them
- **Messages log**: Full JSON-RPC message stream for debugging

## Development workflow

```
1. Write your MCP server
2. Run: npx @modelcontextprotocol/inspector node ./dist/index.js
3. Test all tools in the browser UI
4. Fix issues
5. Connect to Claude Desktop
```

## Key debugging tips

- Check the Messages log if a tool returns unexpected results
- The `initialize` exchange shows exactly what capabilities your server advertised
- Error responses from tools show the full error object
- Use the Inspector before filing bug reports — attach the message log

## Version compatibility

The Inspector should match the SDK version you're using. Both are versioned together
in the `@modelcontextprotocol/*` package family.
