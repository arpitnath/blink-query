---
title: "MCP Adoption and Ecosystem — State of 2025"
source_url: https://modelcontextprotocol.io/
date: 2025-03-01
type: SUMMARY
---

# MCP Adoption and Ecosystem — 2025

Six months after Anthropic's November 2024 launch, MCP has grown into a significant
ecosystem with broad adoption across AI developer tooling.

## Client adoption

| Client | MCP Support | Notes |
|--------|-------------|-------|
| Claude Desktop | Full | Reference implementation |
| Cursor | Full | IDE integration, workspace roots |
| Zed | Full | Open-source editor |
| Cody (Sourcegraph) | Partial | Focus on code search |
| Windsurf (Codeium) | Full | Supports all transport types |
| GitHub Copilot | Announced | In preview |
| OpenAI Agents SDK | Support added | Multi-provider |
| Replit | Full | Cloud workspace |
| Continue.dev | Full | Open-source IDE extension |

The fact that OpenAI added MCP support to their Agents SDK was a watershed moment —
it confirmed MCP as the cross-vendor standard, not just a Claude-specific feature.

## Server ecosystem

By March 2025, the official `modelcontextprotocol/servers` repo lists 20+ reference
servers. The community has built hundreds more:

**Official servers**: filesystem, git, github, gitlab, slack, notion, google-drive,
google-maps, postgres, sqlite, redis, puppeteer, brave-search, fetch, sentry,
everything (test), time, sequential-thinking, memory

**Community highlights**:
- `mcp-server-obsidian` — Obsidian vault access
- `mcp-server-kubernetes` — K8s management
- `mcp-server-snowflake` — Data warehouse queries  
- `mcp-server-jira` — Atlassian Jira
- `mcp-server-confluence` — Atlassian Confluence
- `mcp-server-stripe` — Payment operations
- `mcp-server-aws` — AWS service access

## Registry

MCP Marketplace (https://mcpmarket.com) emerged as an unofficial registry of
community servers, with search, ratings, and one-click install links.
Anthropic has not released an official registry as of March 2025.

## Pain points (community feedback)

1. **Discovery**: No official registry makes finding quality servers hard
2. **Auth for HTTP**: OAuth 2.1 implementation is complex; most servers skip it
3. **Long-running tools**: Tools that take >30s often timeout
4. **Multi-tenant servers**: SSE transport doesn't handle session auth well
5. **Tool call approval UX**: Hosts differ widely in how they handle approval

## What worked well

- **stdio transport**: Universally supported, simple to implement
- **Tool primitive**: Most useful and most used primitive
- **TypeScript SDK**: Well-documented, fast to use
- **Inspector tool**: Significantly reduced development friction
