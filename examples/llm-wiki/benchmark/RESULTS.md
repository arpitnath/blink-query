# LLM Wiki Benchmark Results

Retrieval comparison on the MCP ecosystem corpus
(`examples/llm-wiki/sources/` + `entity/` + `topics/`).

## Corpus

- **30 markdown files** total
  - 24 source documents (MCP spec sections, SDK READMEs, server READMEs, blog posts)
  - 3 entity pages (Anthropic, Tobi Lütke, Model Context Protocol)
  - 2 topic pages (MCP overview, MCP vs function calling)
  - 1 log entry
- **~2,166 lines** of markdown
- Every source file has YAML frontmatter with `title`, `source_url`, `date`, `type`

## Baselines

| Baseline | Approach | External deps |
|---|---|---|
| **grep** | recursive grep over the markdown corpus | none |
| **blink** | blink-query with `WIKI_DERIVERS`, BM25 over typed records | none |

Both baselines run locally with only Node installed. Run them yourself:

```bash
cd examples/llm-wiki
npm install
npm run ingest          # required for blink baseline (populates blink.db)
npm run benchmark       # runs grep and blink in sequence
```

Or run each individually:

```bash
npm run bench:grep
npm run bench:blink
```

## Evaluation questions

15 questions in `questions.json` across four categories:

- **direct-lookup** (6) — questions answered by a single source file
- **entity** (2) — questions about people/organizations/projects in the wiki
- **synthesis** (4) — questions requiring content from multiple sources
- **browse** (3) — questions answered by namespace navigation

## Results (committed)

_The numbers below are filled in by running `npm run benchmark` on the local
machine. The grep baseline uses macOS grep; results on Linux with GNU grep or
ripgrep will differ in absolute terms but the relative ordering is stable._

### Retrieval timing (per query, averaged across 15 questions)

| Baseline | Avg query time | Matched files | Notes |
|---|---|---|---|
| grep (recursive) | _run locally_ | _run locally_ | O(corpus size); every query re-scans the filesystem |
| blink (FTS5 BM25) | _run locally_ | _run locally_ | Single SQL query against the FTS5 index |

### How to interpret this

- **grep** is the simplest possible retrieval: no index, no preprocessing, no
  database. Every query walks the full corpus. It's fast on a 30-file corpus
  but scales linearly with corpus size.
- **blink** precomputes an FTS5 index at ingest time. Queries hit the index,
  not the filesystem. The cost is the one-time ingest, but per-query latency
  is stable as the corpus grows.

For the production-scale comparison (3,890 GitHub issues, blink-query vs a
vectra-based RAG pipeline with local Ollama), see `examples/pathfinder/` and
run `npm run benchmark` in that directory.
