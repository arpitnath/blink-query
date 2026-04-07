---
title: "MCP Server — Notion"
source_url: https://github.com/makenotion/notion-mcp-server
date: 2025-01-15
type: SOURCE
---

# MCP Server — Notion

Official MCP server from Notion (makenotion/notion-mcp-server). Exposes the Notion API
as MCP tools, allowing AI assistants to read and write Notion pages, databases, and blocks.

## Installation

```bash
# NPM global install
npm install -g @notionhq/notion-mcp-server

# Claude Desktop config
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "OPENAPI_MCP_HEADERS": "{\"Authorization\": \"Bearer <your-integration-token>\", \"Notion-Version\": \"2022-06-28\"}"
      }
    }
  }
}
```

## Authentication setup

1. Create a Notion integration at https://www.notion.so/my-integrations
2. Note the Integration Token (starts with `secret_`)
3. Share the pages/databases you want to access with the integration
4. Pass the token via `OPENAPI_MCP_HEADERS`

## Tools exposed (partial list)

The Notion MCP server is generated from the Notion OpenAPI spec, so it exposes a large
surface area:

| Category | Operations |
|----------|-----------|
| Pages | retrieve, update, archive |
| Databases | query, create, retrieve, update |
| Blocks | retrieve, append children, update, delete |
| Users | list, retrieve |
| Search | search across workspace |
| Comments | create, list |

## Capabilities

- **Read pages**: Retrieve any page content as markdown-ish text
- **Write pages**: Update page properties and content
- **Database queries**: Filter and sort database entries
- **Search**: Full-text search across workspace

## Key limitation

The server exposes Notion's REST API verbatim, which means:
- Block content requires multiple API calls to retrieve fully (pagination)
- Rich text is returned as Notion's internal block format, not clean markdown
- Rate limits apply (3 req/s for integrations)

## Typical use cases

- "Summarize my Q4 planning database"
- "Create a new page in my meeting notes database with today's agenda"
- "Search my Notion for anything related to the new feature design"
