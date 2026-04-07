---
title: "MCP Overview — What It Is, Why It Exists, How It Works"
type: SUMMARY
tags:
  - mcp
  - overview
  - topic-page
---

# MCP Overview

The **Model Context Protocol** (MCP) is an open standard released by [[Anthropic]] in
November 2024 that defines how AI applications connect to external data sources, tools,
and services. This page is a synthesized overview — the individual sources it draws
from are listed at the bottom.

## Why MCP exists

Before MCP, every LLM host (Claude Desktop, Cursor, Zed, Windsurf) had to write bespoke
integrations for every tool a user might want: GitHub, Notion, Slack, local files,
databases. This N×M problem explodes: N hosts × M tools = N×M integrations.

MCP solves it by standardising the client-server interface. Any MCP host can talk to
any MCP server, so building a tool integration once gives you access from every host.

## How it works

MCP is a JSON-RPC 2.0 protocol with three roles:

- **Host**: runs the LLM and conversation loop
- **Client**: lives inside the host, one per server connection
- **Server**: out-of-process program exposing tools, resources, prompts

The protocol is transport-agnostic. Two official transports:

- **stdio** — for local servers (Claude Desktop, Claude Code, etc.)
- **Streamable HTTP** — for remote servers (replaced the old HTTP+SSE transport)

## What a server can expose

Each MCP server declares its capabilities during the handshake:

- **Tools** — callable functions the LLM can invoke (e.g. `read_file`, `search_github`)
- **Resources** — readable content the LLM can reference (e.g. files, database rows)
- **Prompts** — templated prompts the host can insert into the conversation
- **Sampling** — the server can request LLM completions from the host
- **Roots** — the workspace directories the server operates within

See [[mcp-tools-resources-prompts]] for the full capability breakdown.

## Adoption

MCP is the de facto standard for LLM tool integration. Hosts: Claude Desktop, Claude
Code, Cursor, Zed, Codex, Windsurf. Official SDKs: TypeScript ([[mcp-sdk-typescript]])
and Python ([[mcp-sdk-python]]).

## Sources drawn from

- [[mcp-specification-overview]]
- [[mcp-transport-layer]]
- [[mcp-lifecycle]]
- [[mcp-tools-resources-prompts]]
- [[mcp-anthropic-launch-2024]]
- [[mcp-adoption-ecosystem-2025]]
