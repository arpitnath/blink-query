---
title: "MCP Transport Layer — stdio, SSE, and Streamable HTTP"
source_url: https://spec.modelcontextprotocol.io/specification/basic/transports/
date: 2024-11-25
type: SOURCE
---

# MCP Transport Layer

MCP is transport-agnostic at the protocol level. The spec defines two official transport
mechanisms and a third emerging standard. All transports exchange JSON-RPC 2.0 messages.

## Stdio transport (local)

The simplest and most common transport for local MCP servers. The host launches the server
as a child process and communicates over stdin/stdout.

```
Host → stdin  → MCP Server
Host ← stdout ← MCP Server
```

- **Use case**: Local tools (filesystem, git, databases, CLI wrappers)
- **Advantages**: Zero network setup, inherits host's filesystem permissions, trivial security model
- **Disadvantages**: Can't be shared across machines, process lifecycle tied to host
- **Example**: `npx -y @modelcontextprotocol/server-filesystem /Users/me/documents`

Newlines delimit JSON-RPC messages. Servers must not write non-JSON-RPC content to stdout
(use stderr for logs).

## HTTP + SSE transport (v1)

For remote/cloud servers that multiple clients share. Uses two HTTP endpoints:

- `GET /sse` — Server-Sent Events stream for server→client messages
- `POST /message` — Client→server messages

The client opens a persistent SSE connection, gets a session ID in the first event, then
POSTs messages to `/message?sessionId=<id>`.

- **Use case**: Cloud-hosted MCP servers, multi-tenant setups
- **Advantages**: Deployable as a web service, firewalls/proxies understand HTTP
- **Disadvantages**: Two connections per session, SSE doesn't work well through some proxies

## Streamable HTTP transport (v2, 2025)

The newer "Streamable HTTP" transport consolidates into a single endpoint. The server
can respond with either a plain JSON response or a streaming SSE body, depending on
whether it has incremental data to send. Clients send JSON-RPC in the request body.

This is the preferred transport for new remote servers as of mid-2025.

## Custom transports

Implementors can define custom transports for WebSocket, gRPC, or other channels — the
JSON-RPC message envelope is the same regardless.

## Message framing

All transports use JSON-RPC 2.0:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": { "name": "read_file", "arguments": { "path": "/etc/hosts" } }
}
```

Notifications (no `id`) are fire-and-forget. Responses must echo the request `id`.
