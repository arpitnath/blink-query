---
title: "Anthropic MCP Launch — November 2024"
source_url: https://www.anthropic.com/news/model-context-protocol
date: 2024-11-25
type: SUMMARY
---

# Anthropic Launches Model Context Protocol (November 2024)

On November 25, 2024, Anthropic announced the Model Context Protocol as an open standard
for connecting AI assistants to the systems where data lives. The announcement positioned
MCP as an answer to the "context fragmentation" problem — AI systems being isolated from
the data and tools users actually work with.

## Key framing from the launch

Anthropic's blog post used the analogy of a USB-C port: just as USB-C standardized how
devices connect to peripherals, MCP standardizes how AI connects to the rest of the
software stack. The vision: "any AI, any tool, one protocol."

The launch came with:
- Open specification published at modelcontextprotocol.io
- Open-source TypeScript and Python SDKs
- Reference servers for popular tools (filesystem, GitHub, Slack, Google Drive, Postgres)
- Claude Desktop as the first host supporting MCP

## Early partners

Several companies announced MCP support at launch:
- **Block** (Cash App, Square) — integrating internal tools
- **Apollo** — GraphQL tooling
- **Zed** — code editor integration
- **Replit** — development environment
- **Codeium** — AI coding assistant
- **Sourcegraph** — code intelligence

## Community response

The announcement generated significant HN discussion (800+ points). The prevailing reaction
was positive surprise that Anthropic was opening the protocol rather than keeping it
proprietary. Key discussion themes:

- Comparison to OpenAI's function calling (MCP is broader, out-of-process)
- Questions about security model (each server runs with the host's permissions)
- Interest in the SSE transport for cloud-hosted servers
- Skepticism about whether the protocol would get adoption beyond Claude users

## What shipped at launch

1. `@modelcontextprotocol/sdk` — TypeScript SDK for building servers
2. `mcp` — Python SDK
3. Reference servers: filesystem, GitHub, Slack, Google Drive, Postgres, SQLite, Brave Search, Puppeteer, Fetch, Everything (test server)
4. MCP Inspector — a browser-based debugging tool

## Significance

This was Anthropic's first major open-source protocol contribution. It positioned Claude
as "the AI that connects to your stack" — distinct from ChatGPT's more closed plugin
ecosystem. The bet: if developers build MCP servers for their tools, those tools become
Claude-compatible automatically.
