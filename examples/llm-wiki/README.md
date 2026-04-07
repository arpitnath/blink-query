# llm-wiki — An LLM Wiki Example for blink-query

A runnable example showing how to use blink-query to build Andrej Karpathy's
[LLM wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)
with typed records, path resolution, and automatic `[[wikilink]]` extraction.

The corpus is 30 curated markdown files about the Model Context Protocol
ecosystem — a meta-appropriate choice for a tool that ships as an MCP server.

## What's in here

```
examples/llm-wiki/
├── sources/          # 24 raw source documents (MCP spec, SDK READMEs, etc.)
│   └── *.md          # each with YAML frontmatter: title, source_url, date, type
├── entity/           # 3 synthesized entity pages (people, orgs, protocols)
├── topics/           # 2 synthesized topic overview pages
├── log/              # ingest log entries, namespaced by date
│   └── 2026-04-08/
├── benchmark/        # 4-way benchmark vs Karpathy grep, raw RAG, and qmd
│   ├── harness.ts    # runs all baselines
│   ├── karpathy-baseline.ts  # markdown + grep
│   ├── blink-baseline.ts     # blink-query BM25
│   ├── questions.json        # 15 eval questions
│   └── RESULTS.md            # benchmark numbers (run locally)
├── ingest.ts         # populate blink.db using WIKI_DERIVERS
├── query.ts          # example agent queries via blink
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

# Run the benchmark (karpathy + blink baselines by default)
npm run benchmark
```

## How It Works

The `ingest.ts` script walks the corpus with `loadDirectory()`, then calls
`blink.ingest(docs, { ...WIKI_DERIVERS, extractLinks: true })`. The
`WIKI_DERIVERS` preset classifies each file based on frontmatter and extension:

- Files with `source_url:` in frontmatter → **SOURCE** records
- `.md` files with headings and no `source_url` → **SUMMARY** records
  (synthesized wiki pages)
- Frontmatter `type: META` pages → **META** records with structured content
- `.json` / `.yaml` files → **META** records

`extractLinks: true` scans every record's summary for `[[wikilinks]]`,
looks up each target by keyword search, and creates **ALIAS** records at
`<source.path>/aliases/<target>` pointing to the resolved path.

Namespace routing is automatic:

- `sources/foo.md` → `sources/foo`
- `entity/alice/bio.md` → `entity/alice`
- `topics/mcp-overview.md` → `topics/mcp-overview`
- `log/2026-04-08/ingest.md` → `log/2026-04-08`

## Using This Wiki With an LLM Agent

Drop the top-level `BLINK_WIKI.md` file (at the repo root) into your LLM
agent's project context. It documents the typed record model, the namespace
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

## What This Example Demonstrates

1. **Typed records from frontmatter** — the `WIKI_DERIVERS` classifier turns
   metadata into the right record type without manual intervention.
2. **Path resolution vs keyword search** — `blink.resolve('topics/mcp-overview')`
   is O(1) and deterministic; no embedding, no search, no guessing.
3. **Automatic cross-references** — `[[wikilinks]]` in entity and topic pages
   become ALIAS records pointing at the real targets.
4. **Namespace browsing** — `blink.list('entity/')` returns every entity page
   without needing a pre-built index.
5. **Benchmark comparison** — run the same 15 questions against grep, BM25
   over typed records, raw RAG, and qmd.

## Running the Benchmark Locally

The Karpathy (grep) and blink baselines have no external dependencies and
should always work. The RAG baseline needs Ollama with `nomic-embed-text` and
`ministral-3` installed locally. The qmd baseline needs the `qmd` CLI
installed separately.

```bash
# Minimum — karpathy + blink
npm run benchmark

# Add RAG (needs Ollama)
BASELINES=karpathy,blink,rag npm run benchmark

# Add qmd (needs qmd installed)
BASELINES=karpathy,blink,rag,qmd npm run benchmark
```

See `benchmark/RESULTS.md` for the full comparison table.

## Reference

For the production-scale benchmark on 3,890 GitHub issues (the numbers cited
in the top-level README), see `examples/pathfinder/` — that benchmark shipped
with blink-query v1.1.0.
