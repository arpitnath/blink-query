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

## Results

Captured on Darwin arm64 (Apple Silicon), Node v22.22, better-sqlite3 12.x,
macOS grep. 15 questions against the 32-record corpus. Reproduce locally
with `npm run benchmark`.

### Retrieval timing (per query, averaged across 15 questions)

| Baseline | Avg query time | Total time (15 q) | Top-hit shape | Notes |
|---|---|---|---|---|
| grep (recursive) | **~21 ms** | 320 ms | Matches every file containing any keyword (broad) | O(corpus size) — every query re-scans the filesystem |
| blink (FTS5 BM25) | **<1 ms** | 4 ms | Top-5 ranked records, typed (focused) | One SQL query against the FTS5 index |

**~20× faster, and the results are focused rather than broad.** Grep returns 351
file matches across 15 questions — every file that contains any keyword.
blink returns 75 ranked top-5 hits — the records most relevant to each query,
with their record type so the agent knows what to do with each one.

### How to interpret this

- **grep** is the simplest possible retrieval: no index, no preprocessing, no
  database. Every query walks the full corpus with `grep -r -l -i`. Per-query
  latency grows linearly with corpus size. Results are file paths only; the
  caller still has to open and read each match.
- **blink** precomputes an FTS5 index at ingest time (one-time cost: ~24 ms
  for 32 records). Queries hit the index, not the filesystem. Per-query
  latency is stable as the corpus grows. Results are typed records — the
  caller gets the title, summary, type, and path without touching disk.

The grep numbers will differ on other platforms (Linux with GNU grep or
ripgrep is typically faster), but the relative ordering is stable.

For the production-scale comparison (3,890 GitHub issues, blink-query vs a
vectra-based RAG pipeline with local Ollama), see `examples/pathfinder/` and
run `npm run benchmark` in that directory.
