---
title: "Karpathy's LLM Wiki — The Concept"
source_url: https://gist.github.com/karpathy/2cf7f675e88c944c1ffa1f8b72bff093
date: 2025-02-01
type: SUMMARY
---

# Karpathy's LLM Wiki Concept

Andrej Karpathy proposed the "LLM wiki" pattern as a structured way to give language
models access to curated, maintained documentation rather than relying on web search
or fragmented context stuffing.

## Core idea

Instead of:
1. Dumping entire docs into context (too large, low signal-to-noise)
2. Relying on web search (stale, unreliable, hallucination-prone)

Build a **curated, compact wiki** of markdown files that an AI can search and reference.
The wiki is maintained by humans and ingested by the AI on demand.

## The gist proposal

Karpathy's original gist outlined a minimal wiki format:

```markdown
---
title: "Python asyncio — Key Concepts"
tags: [python, async, concurrency]
updated: 2025-01-15
---

# Python asyncio key concepts
...
```

Key properties:
- **Markdown**: Human-readable, easy to edit
- **Frontmatter**: Structured metadata for filtering and retrieval
- **Compact**: Each entry is a focused summary, not a full tutorial
- **Versioned**: Tracked in git, can be diffed
- **Searchable**: Simple grep or BM25 retrieval

## The retrieval pattern

For a query, the wiki is searched (grep or embedding search) for the 3-5 most relevant
entries. Those entries are injected into the AI's context as background knowledge.

```
User question → keyword search → top 3 wiki entries → AI with context
```

This is fundamentally simpler than RAG: no vector embeddings needed, no chunking, no
embedding model. The trade-off: wiki entries must be pre-curated (manual curation work).

## Karpathy's key insight

> "The LLM doesn't need the whole internet — it needs a curated, up-to-date cheat sheet
> for the domain it's working in."

Most professional coding tasks involve a small, bounded set of libraries, APIs, and
concepts. A 50-file wiki of markdown covering those concepts outperforms unbounded
web search for in-domain questions.

## Relation to blink-query

blink-query implements the LLM wiki pattern with enhanced retrieval:
- FTS5 BM25 search instead of plain grep
- Typed records (SUMMARY vs SOURCE vs META)
- MCP server for agent access
- ALIAS-based linking between entries
- Namespace zones for corpus organization

The "blink wiki" is a Karpathy wiki that an AI agent can query via MCP.
