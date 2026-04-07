---
title: "Model Context Protocol — Specification Overview"
source_url: https://spec.modelcontextprotocol.io/specification/
date: 2024-11-25
type: SUMMARY
---

# Model Context Protocol — Specification Overview

The Model Context Protocol (MCP) is an open standard that defines how AI applications
connect to external data sources, tools, and services. It decouples the "what the AI can
access" concern from the "how the host application integrates everything" concern.

## Why MCP exists

Before MCP, every AI product (Claude.ai, Cursor, Zed, etc.) had to write bespoke
integrations for every tool a user might want: GitHub, Notion, Slack, databases, local
files. This N×M problem — N clients × M tools — explodes quickly. MCP solves it by
standardizing the interface so any MCP client speaks to any MCP server.

## Protocol architecture

MCP is a client-server protocol layered on top of JSON-RPC 2.0. There are three parties:

- **Host**: The application hosting the AI model (e.g. Claude Desktop, Cursor)
- **Client**: Lives inside the host, maintains a 1:1 connection with a server
- **Server**: An out-of-process program exposing capabilities to the AI

The host is responsible for running the LLM and the conversation loop. The client and
server speak MCP to transfer capabilities and data.

## Core primitives

MCP defines three capability primitives:

| Primitive | Owner | Purpose |
|-----------|-------|---------|
| **Tools** | Model-controlled | Functions the AI calls (like function calling) |
| **Resources** | Application-controlled | Files, DB rows, API responses the host can subscribe to |
| **Prompts** | User-controlled | Reusable prompt templates invoked by users |

Tools are the most commonly used primitive — they allow the AI model to invoke actions
on external systems (fetch a URL, read a file, write to a database).

## Protocol versioning

MCP uses a date-based version string (e.g. `2024-11-05`). During `initialize`, client
and server negotiate the latest version both support. This allows forwards compatibility
without breaking old servers.

## Key design decisions

1. **Out-of-process servers**: Each MCP server is a separate process, enhancing isolation
   and allowing servers to be written in any language.
2. **Capability negotiation**: Servers declare what they support during handshake; clients
   don't assume capabilities.
3. **Stateful sessions**: Unlike REST, MCP maintains session state — resources can send
   notifications when they change.
4. **Human-in-the-loop**: The spec explicitly reserves certain actions for user approval,
   preventing fully autonomous execution without consent.
