---
title: "Model Context Protocol"
type: META
tags:
  - protocol
  - standard
  - mcp
---

# Model Context Protocol (MCP)

Open protocol developed by [[Anthropic]] and released in November 2024 for connecting
AI applications to external tools, data sources, and services through a standardised
JSON-RPC interface.

## Core design

MCP is a client-server protocol over JSON-RPC 2.0. Three roles:

- **Host** — the application running the LLM (e.g. [[Claude Desktop]], Cursor, Zed)
- **Client** — lives inside the host, maintains one connection per server
- **Server** — an out-of-process program exposing capabilities

The protocol is transport-agnostic but ships with two official transports: stdio
(for local servers) and Streamable HTTP (for remote servers).

## Capabilities

An MCP server can expose:

- **Tools** — callable functions the LLM can invoke
- **Resources** — readable content the LLM can reference
- **Prompts** — templated prompts the host can insert
- **Sampling** — the server can ask the host's LLM to generate text
- **Roots** — workspace root directories the server operates on

## Adoption

As of early 2025, MCP is the de facto standard for LLM tool integration. Every major
host supports it: Claude Desktop, Claude Code, Cursor, Zed, Codex, Windsurf.

## Related sources

- [[mcp-specification-overview]] — the spec itself
- [[mcp-transport-layer]] — transport details
- [[mcp-tools-resources-prompts]] — capability taxonomy
- [[mcp-lifecycle]] — connection lifecycle
- [[mcp-anthropic-launch-2024]] — launch announcement
