---
title: "MCP Connection Lifecycle — Initialize, Running, Shutdown"
source_url: https://spec.modelcontextprotocol.io/specification/basic/lifecycle/
date: 2024-11-25
type: SOURCE
---

# MCP Connection Lifecycle

An MCP session goes through three phases: initialization, running, and shutdown. The
handshake is symmetrical — both sides declare their protocol version and capabilities
before any tools or resources are used.

## Phase 1: Initialization

```
Client                          Server
  │── initialize ──────────────► │
  │                              │
  │◄── InitializeResult ─────── │
  │                              │
  │── initialized (notify) ────► │
```

### `initialize` request (client → server)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "roots": { "listChanged": true },
      "sampling": {}
    },
    "clientInfo": { "name": "Claude Desktop", "version": "1.2.0" }
  }
}
```

### `InitializeResult` (server → client)

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": "2024-11-05",
    "capabilities": {
      "tools": { "listChanged": true },
      "resources": { "subscribe": true, "listChanged": true },
      "prompts": {}
    },
    "serverInfo": { "name": "my-server", "version": "0.3.0" }
  }
}
```

The server responds with the protocol version it will use (≤ what the client requested).
After the client sends `initialized`, the session is active.

## Phase 2: Running

Normal operation — client sends requests (tools/call, resources/read, etc.) and the
server responds. Servers can also send notifications (resources/updated, progress).

Key operations during running phase:

| Operation | Direction | Description |
|-----------|-----------|-------------|
| `tools/list` | C→S | Get available tools |
| `tools/call` | C→S | Execute a tool |
| `resources/list` | C→S | Get available resources |
| `resources/read` | C→S | Read resource content |
| `resources/subscribe` | C→S | Subscribe to resource changes |
| `resources/updated` | S→C | Resource change notification |
| `prompts/list` | C→S | Get prompt templates |
| `prompts/get` | C→S | Expand a prompt template |
| `logging/setLevel` | C→S | Configure log verbosity |

## Phase 3: Shutdown

Either side can initiate shutdown. The preferred mechanism is simply closing the transport
connection. For stdio, this means closing stdin/stdout. No explicit shutdown message is
required by the spec, though implementors may add one.

## Error handling

JSON-RPC errors use standard codes:

| Code | Meaning |
|------|---------|
| -32700 | Parse error |
| -32600 | Invalid request |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32001 | Request timeout (MCP extension) |
