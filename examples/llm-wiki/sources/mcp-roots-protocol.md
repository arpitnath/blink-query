---
title: "MCP Roots — Client File System Boundaries"
source_url: https://spec.modelcontextprotocol.io/specification/client/roots/
date: 2024-11-25
type: SOURCE
---

# MCP Roots

Roots is a client capability that tells MCP servers which parts of the host's filesystem
the client considers relevant. Servers can request this information to scope their
operations to the user's current project.

## Purpose

Without roots, a server like an AI code editor would have no way to know where the
user's project lives. Roots provides this without requiring the user to configure
each server separately.

## Root object

```json
{
  "uri": "file:///Users/alice/projects/my-app",
  "name": "my-app"
}
```

A root has a URI (typically a `file://` path) and an optional display name.

## Flow

```
Server → roots/list request → Client
Client → { roots: [...] } → Server
Client → roots/listChanged notification (when project changes)
```

1. Server declares `roots: { listChanged: true }` capability during `initialize`
2. Server sends `roots/list` request at any time
3. Client responds with current roots
4. When the user opens a different project, the client sends `roots/listChanged`

## Implementation in hosts

**Claude Desktop**: Roots correspond to the user's current open directories.
**Cursor/Zed**: Roots correspond to the open workspace folders.

## Use by servers

A filesystem server might use roots to:
- Default the `search_files` scope to the roots
- Refuse operations outside root paths
- Show a warning when asked to modify files outside roots

The filesystem reference server doesn't implement roots yet — it uses its CLI
argument directories as the access boundaries instead.

## Roots vs allowed directories

| Mechanism | Set by | Server behavior |
|-----------|--------|----------------|
| CLI args | Server config | Hard block on access |
| Roots | Client/host | Advisory — server chooses whether to respect |

Roots are informational. The server still controls what it allows.
