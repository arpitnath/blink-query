---
title: "Initial wiki ingest — MCP ecosystem corpus"
type: META
tags:
  - log
  - ingest
date: 2026-04-08
---

# Initial wiki ingest

First population of the `examples/llm-wiki` corpus for the blink-query v2.0.0 LLM wiki
pattern demonstration.

## What was added

- **24 source files** (`sources/*.md`) — curated MCP ecosystem references:
  - MCP specification sections (transport, lifecycle, tools/resources/prompts, roots, sampling, auth)
  - Anthropic launch announcement and ecosystem adoption report
  - Reference SDK READMEs (TypeScript, Python)
  - Server READMEs (GitHub, Notion, Slack, Linear, memory, postgres, filesystem, fetch)
  - Tooling READMEs (qmd, inspector)
  - Meta-sources (Karpathy LLM wiki concept, Rohit G LLM wiki v2)
- **3 entity pages** (`entity/*.md`) — synthesized entity records:
  - Anthropic (organization)
  - Tobi Lütke (person)
  - Model Context Protocol (protocol)
- **2 topic pages** (`topics/*.md`) — synthesized overview pages:
  - MCP Overview
  - MCP vs Function Calling

## Classification expectations

With `WIKI_DERIVERS` and `source_url` frontmatter:

- Source files with `source_url:` → classified as SOURCE
- Entity pages (type META) → classified as META, content passes through
- Topic pages (type SUMMARY) → classified as SUMMARY
- This log entry (type META) → classified as META

## Expected wikilink extraction

Entity and topic pages contain `[[wikilinks]]` to other corpus entries. With
`extractLinks: true`, these should auto-generate ALIAS records under each record's
`<path>/aliases/` namespace.

## Reference

- Schema document: `BLINK_WIKI.md`
- Benchmark harness: `benchmark/harness.ts`
