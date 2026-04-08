---
title: "qmd — Tobi Lütke's LLM-Friendly Markdown Corpus Tool"
source_url: https://github.com/tobi/qmd
date: 2025-03-01
type: SUMMARY
---

# qmd — Tobi Lütke's LLM Markdown Tool

`qmd` is a minimal command-line tool by Tobi Lütke (CEO of Shopify) for maintaining
and querying a personal knowledge base of markdown files, designed for use with LLMs.

## Philosophy

Lütke built qmd from the frustration that RAG systems are overengineered for most use
cases. A curated set of markdown files, searchable with BM25 or grep, handles 90% of
personal knowledge base queries without embeddings, vector databases, or chunking pipelines.

The tool is intentionally minimal:

```bash
qmd add "My note about Go generics"
qmd search "generics"
qmd ls
qmd show <id>
```

## Format

qmd stores files as markdown with a minimal header:

```markdown
# Go generics: key patterns

Go 1.18 added generics via type parameters...
```

No frontmatter required. Titles come from the first H1. Tags and metadata are optional.

## Key design choices

1. **Flat file storage**: No database — files are the source of truth
2. **BM25 search**: Uses lunr.js or ripgrep under the hood, not embeddings
3. **LLM integration**: `qmd query "how do I use generics?"` formats results
   for LLM context injection
4. **Version control friendly**: Plain markdown, designed to live in a git repo

## The Shopify context

Lütke has discussed using a similar pattern internally at Shopify — a shared markdown
knowledge base that Copilot and Claude can reference for company-specific conventions,
architecture decisions, and runbooks.

The idea: internal wikis (Notion, Confluence) are too noisy and poorly structured for
AI consumption. A curated, engineer-maintained markdown corpus is far more useful.

## Comparison to blink-query

| Feature | qmd | blink-query |
|---------|-----|-------------|
| Storage | Flat files | SQLite |
| Search | BM25/grep | FTS5 BM25 |
| Types | Untyped | 5 semantic types |
| MCP | No | Yes (9 tools) |
| Linking | No | ALIAS chains |
| CLI | Yes | Yes |
| Namespaces | No | Yes (zones) |

blink-query is spiritually similar to qmd but adds the MCP layer and semantic typing
for agent consumption.
