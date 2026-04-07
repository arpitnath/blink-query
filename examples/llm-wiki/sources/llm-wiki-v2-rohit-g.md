---
title: "LLM Wiki v2 — Rohit G's Specification"
source_url: https://github.com/rohitg00/llm-wiki-v2
date: 2025-03-15
type: SUMMARY
---

# LLM Wiki v2 — Rohit G's Specification

Rohit G's LLM Wiki v2 extends the Karpathy wiki concept with a more structured schema,
versioning discipline, and agent-oriented retrieval patterns.

## Motivation

The original wiki pattern (markdown + grep) breaks down at scale:
- 200+ files make grep results noisy
- No way to distinguish authoritative summaries from raw notes
- No citation tracking across entries
- Manual updates don't scale to team use

LLM Wiki v2 adds structure without sacrificing simplicity.

## Core schema

Every wiki entry uses a structured frontmatter:

```yaml
---
id: mcp-transport-01
title: "MCP Transport Layer"
type: concept           # concept | howto | reference | decision | log
status: current         # current | draft | deprecated | archived
confidence: high        # high | medium | low
sources:
  - url: https://spec.modelcontextprotocol.io
    accessed: 2025-03-01
related:
  - mcp-lifecycle-01
  - mcp-primitives-01
updated: 2025-03-15
---
```

## Entry types

| Type | Purpose | Keep short? |
|------|---------|-------------|
| `concept` | Explain what something is | Yes (< 500 words) |
| `howto` | Explain how to do something | Medium (< 1000 words) |
| `reference` | API/config reference | Tables OK |
| `decision` | Why we chose X over Y (ADR style) | Yes |
| `log` | Dated notes, meeting summaries | No constraint |

## Retrieval design

v2 proposes a two-stage retrieval:

1. **Filter by type**: If the query is "how to configure X", only search `howto` and `reference` entries
2. **BM25 rank**: Score remaining entries by term overlap

This is more precise than semantic embedding search for technical wikis where terminology
is well-defined.

## Team wiki discipline

For team use, v2 recommends:
- One entry per concept (enforce via CI lint)
- PR review for `concept` and `decision` entries
- `log` entries can be committed directly
- Automated staleness check: entries older than 6 months without `updated` flag a warning

## Relation to blink-query WIKI_DERIVERS

blink-query's `WIKI_DERIVERS` preset implements this spec's type system as blink record
types. The mapping:

| Wiki v2 type | Blink record type |
|--------------|------------------|
| `concept` | SUMMARY |
| `howto` | SOURCE |
| `reference` | META |
| `decision` | META |
| `log` | META |
