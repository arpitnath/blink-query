# llm-wiki — An LLM wiki example for blink-query

A runnable example showing how to use blink-query to build a typed wiki from
a corpus of markdown files. Demonstrates the `WIKI_DERIVERS` preset, path
resolution, automatic `[[wikilink]]` extraction, and a retrieval benchmark.

The corpus is 30 curated markdown files about the Model Context Protocol
ecosystem — an on-brand choice for a tool that ships as an MCP server.

## What's in here

```
examples/llm-wiki/
├── sources/          # 24 source documents (MCP spec, SDK READMEs, etc.)
│   └── *.md          # each with YAML frontmatter: title, source_url, date, type
├── entity/           # 3 entity pages (organizations, people, protocols)
├── topics/           # 2 topic overview pages
├── log/              # ingest log entries, namespaced by date
│   └── 2026-04-08/
├── benchmark/        # retrieval benchmark over the corpus
│   ├── harness.ts    # runs both baselines
│   ├── grep-baseline.ts      # recursive grep over markdown
│   ├── blink-baseline.ts     # blink-query BM25 over typed records
│   ├── questions.json        # 15 evaluation questions
│   └── RESULTS.md            # committed comparison numbers
├── ingest.ts         # populate blink.db using WIKI_DERIVERS
├── query.ts          # example queries via blink
└── package.json
```

## Quick Start

```bash
cd examples/llm-wiki
npm install

# Populate blink.db from the corpus
npm run ingest

# Run example queries
npm run query

# Run the retrieval benchmark (grep vs blink BM25)
npm run benchmark
```

## How it works

The `ingest.ts` script walks the corpus with `loadDirectory()`, then calls
`blink.ingest(docs, { ...WIKI_DERIVERS, extractLinks: true })`. The
`WIKI_DERIVERS` preset classifies each file based on frontmatter and extension:

- Files with `source_url:` in frontmatter → **SOURCE** records
- `.md` files with headings and no `source_url` → **SUMMARY** records
- Frontmatter `type: META` pages → **META** records with structured content
- `.json` / `.yaml` files → **META** records

`extractLinks: true` scans every record's summary for `[[wikilinks]]`, looks
up each target by keyword search, and creates **ALIAS** records at
`<source.path>/aliases/<target>` pointing to the resolved path.

Namespace routing is automatic:

- `sources/foo.md` → `sources/foo`
- `entity/alice/bio.md` → `entity/alice`
- `topics/mcp-overview.md` → `topics/mcp-overview`
- `log/2026-04-08/ingest.md` → `log/2026-04-08`

## Using this wiki with an LLM agent

Drop the top-level `BLINK_WIKI.md` file (at the repo root) into your agent's
project context. It documents the typed record model, the namespace
conventions, and the MCP tool names. Then configure your agent to use the
blink-query MCP server:

```bash
# Install blink-query and auto-configure your agents
npx blink-query init

# Point at this example's database
blink --db examples/llm-wiki/data/blink.db resolve "topics/mcp-overview"
```

Your agent can now resolve paths like:

- `topics/mcp-overview` — a synthesized wiki page about MCP
- `entity/anthropic` — entity page about Anthropic
- `sources/mcp-transport-layer` — the raw source doc
- `sources/` — a COLLECTION of all sources
- `topics/mcp-overview/aliases/` — ALIAS records for `[[wikilinks]]` mentioned in the page

## What this example demonstrates

1. **Typed records from frontmatter** — the `WIKI_DERIVERS` classifier turns
   metadata into the right record type without manual intervention.
2. **Path resolution vs keyword search** — `blink.resolve('topics/mcp-overview')`
   is O(1) and deterministic; no embedding, no search, no guessing.
3. **Automatic cross-references** — `[[wikilinks]]` in entity and topic pages
   become ALIAS records pointing at the real targets.
4. **Namespace browsing** — `blink.list('entity/')` returns every entity page
   without needing a pre-built index.
5. **Retrieval comparison** — run the same 15 questions against grep and
   blink BM25 on the same corpus; see `benchmark/RESULTS.md` for the numbers.

## Running the benchmark

Both baselines run locally with no external dependencies beyond Node:

```bash
# Run both baselines
npm run benchmark

# Or run individually
npm run bench:grep
npm run bench:blink
```

See `benchmark/RESULTS.md` for the committed numbers and `benchmark/questions.json`
for the evaluation set.

## Larger benchmark

For a production-scale benchmark on 3,890 GitHub issues, see
`examples/pathfinder/` — that benchmark shipped with blink-query v1.1.0 and
compares blink-query BM25 against a vectra-based RAG pipeline with local
Ollama.
