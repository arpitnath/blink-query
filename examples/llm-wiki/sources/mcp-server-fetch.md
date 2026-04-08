---
title: "MCP Server — Fetch (Web Content)"
source_url: https://github.com/modelcontextprotocol/servers/tree/main/src/fetch
date: 2024-11-25
type: SOURCE
---

# MCP Server — Fetch

Official MCP server for fetching web content. Converts HTML to markdown for clean
AI consumption. Optionally supports robots.txt compliance.

## Installation

```bash
npx -y @modelcontextprotocol/server-fetch

# With Puppeteer for JS-rendered pages (Python version)
pip install mcp-server-fetch
```

## Tools exposed

| Tool | Description |
|------|-------------|
| `fetch` | Fetch a URL and return content as markdown |

## How it works

1. Makes HTTP GET request to the URL
2. Parses HTML with a headless DOM
3. Extracts main content (removes nav, ads, boilerplate)
4. Converts to clean markdown
5. Returns with page title and URL

**Input**:
```json
{
  "url": "https://example.com/article",
  "max_length": 5000,
  "start_index": 0,
  "raw": false
}
```

Setting `raw: true` returns the raw HTML instead of markdown.

## robots.txt handling

The TypeScript version respects `robots.txt` by default. This can be toggled with
`--ignore-robots-txt` flag. The Python version also has configurable robots.txt behavior.

## Common use cases

**Research assistant**:
> "Read https://blog.example.com/mcp-guide and summarize the key points"

**Documentation lookup**:
> "Fetch the Blink Query API docs and tell me how to use the search method"

**Competitive research**:
> "Read the pricing pages of these 3 competitors and compare them"

## Limitations

- Cannot handle sites requiring authentication (cookies, session)
- JavaScript-heavy SPAs may not render correctly (TypeScript version uses basic HTTP)
- PDF and binary content not supported
- Rate limiting and blocking by target sites

## Python vs TypeScript version

The Python version (`mcp-server-fetch`) uses Playwright for JS-rendered pages, making
it better for modern web apps. The TypeScript version uses plain HTTP + HTML parsing,
making it faster and simpler for static sites.
