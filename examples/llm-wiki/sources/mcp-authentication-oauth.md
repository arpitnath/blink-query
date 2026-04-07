---
title: "MCP Authentication — OAuth 2.1 and API Keys"
source_url: https://spec.modelcontextprotocol.io/specification/basic/security/
date: 2025-03-01
type: SOURCE
---

# MCP Authentication

Authentication in MCP is handled at the transport layer, not the protocol layer. The
spec defines a recommended OAuth 2.1 flow for HTTP-based servers.

## For stdio servers

No authentication needed at the transport level — the server runs as a child process
of the host and inherits its environment. Secrets are passed via environment variables:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

The host is responsible for setting these environment variables from a secrets store.

## For HTTP/SSE servers

HTTP-based servers must handle authentication themselves. The spec recommends OAuth 2.1
with PKCE for user-facing servers.

### OAuth 2.1 flow

```
Client → GET /.well-known/oauth-authorization-server
         (discover auth server metadata)

Client → redirect user to Authorization Endpoint
User   → authenticates and authorizes

Client ← receives authorization code

Client → POST /token (exchange code for access token)
         (with PKCE code_verifier)

Client → includes Bearer token in all MCP requests
         Authorization: Bearer <token>
```

### Server metadata discovery

```
GET /.well-known/oauth-authorization-server

Response:
{
  "issuer": "https://my-mcp-server.com",
  "authorization_endpoint": "https://my-mcp-server.com/authorize",
  "token_endpoint": "https://my-mcp-server.com/token",
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"]
}
```

## Security considerations

### Tool injection attacks

A malicious server could provide a tool that tricks the AI into doing harmful things.
Mitigations:
- Only install servers from trusted sources
- Review tool names and descriptions before approving
- Hosts should show tool calls to users before executing

### Secret exposure

Tools can return arbitrary text. A compromised server could ask the AI to re-read
environment variables containing other secrets. Mitigations:
- Don't pass sensitive secrets as env vars to MCP servers
- Use per-server secret scoping in host applications

### Resource exfiltration

A server could trick the AI into reading a sensitive file and including it in output.
Mitigation: filesystem server's allowed-directory restriction.

## Current state (2025)

OAuth for MCP is defined in the spec but not widely implemented. Most servers use:
- API keys via environment variables (simplest)
- No auth (localhost/stdio only)

Production deployments with multi-user SSE servers are where OAuth becomes necessary.
