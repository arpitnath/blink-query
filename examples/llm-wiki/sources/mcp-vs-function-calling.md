---
title: "MCP vs Function Calling — Key Differences"
source_url: https://spec.modelcontextprotocol.io/specification/
date: 2024-12-01
type: SUMMARY
---

# MCP vs Function Calling — Key Differences

Function calling (OpenAI, Anthropic tool_use) and MCP are often confused because both let
AI models use external tools. They operate at different layers.

## Conceptual distinction

| Aspect | Function Calling | MCP |
|--------|-----------------|-----|
| Where tools run | In-process with the host app | Out-of-process, separate server |
| Who defines tools | Developer codes them per-app | Server author, once, reusable |
| Reusability | App-specific | Any MCP client |
| Capabilities | Tools only | Tools + Resources + Prompts |
| Discovery | Static at compile time | Dynamic at runtime |
| State | Stateless per request | Stateful session |
| Transport | API call | stdio / HTTP / SSE |

## Layering relationship

MCP and function calling are complementary:

```
User
 │
 ▼
Host App (e.g. Claude Desktop)
 │
 ├── Function calling ──► LLM API (Anthropic/OpenAI) ─► text generation
 │
 └── MCP clients ──────► MCP servers ─► tools, resources, prompts
                          (file, git,     (out-of-process,
                           db, API, ...)   reusable)
```

The LLM API generates text and decides to call tools. The host app intercepts those tool
calls and routes them — either to in-process handlers (traditional function calling) or
to MCP servers (new model).

## When to use each

**Use function calling when**:
- Tools are tightly coupled to your app's logic
- You need maximum control over execution
- You're building a simple tool-using workflow

**Use MCP when**:
- You want tools usable across multiple AI clients
- You want to expose an existing service (Notion API, PostgreSQL) without coupling it to one app
- You want live resource subscriptions
- You're building a platform for others to extend

## The "N×M solved" claim

Anthropic's pitch: without MCP, building N AI clients that each need M tools requires N×M
integrations. MCP collapses this to N+M: each client implements MCP once, each tool
implements MCP once, and they all interoperate.

In practice (early 2025), this mostly works for stdio servers but requires more
infrastructure for SSE/cloud servers (auth, deployment, session management).
