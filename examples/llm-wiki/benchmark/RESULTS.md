# LLM Wiki Benchmark Results

Comparison of retrieval approaches on the MCP ecosystem corpus
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
| **karpathy** | markdown + `grep` over the corpus | none |
| **blink** | blink-query with `WIKI_DERIVERS` preset, BM25 retrieval over typed records | none |
| **rag** | vectra index over chunked markdown, Ollama embeddings + generation | Ollama + nomic-embed-text + ministral-3 |
| **qmd** | Tobi Lütke's qmd tool (BM25 over markdown with frontmatter) | qmd CLI |

## Evaluation Questions

15 questions in `questions.json` across four categories:

- **direct-lookup** (6) — questions answered by a single source file
- **entity** (2) — questions about people/organizations/projects in the wiki
- **synthesis** (4) — questions requiring content from multiple sources
- **browse** (3) — questions answered by namespace navigation

## How to Run

```bash
cd examples/llm-wiki

# 1. Populate blink.db from the corpus (required for blink baseline)
npm run ingest

# 2. Run all available baselines (karpathy + blink by default)
npm run benchmark

# 3. Run individual baselines
npm run bench:karpathy
npm run bench:blink

# 4. Enable optional baselines
BASELINES=karpathy,blink,rag npm run benchmark   # needs Ollama
BASELINES=karpathy,blink,rag,qmd npm run benchmark   # needs qmd too
```

## Results

> **Note:** Numbers below are placeholders. Run the harness locally on your
> machine to populate real values. The Karpathy and blink baselines have zero
> external dependencies and should always run. The RAG and qmd baselines are
> best-effort — they require local Ollama and qmd installations respectively.

### Retrieval Performance

| Baseline | Avg Query Time | Total Hits | Notes |
|---|---|---|---|
| karpathy (grep) | _run locally_ | _run locally_ | O(corpus size), stable |
| blink (BM25)    | _run locally_ | _run locally_ | O(log n) via FTS5 index |
| rag (vectra)    | _run locally_ | _run locally_ | Embedding + cosine search |
| qmd             | _run locally_ | _run locally_ | BM25 + optional re-rank |

### Accuracy (LLM-judged)

| Baseline | Direct-lookup | Entity | Synthesis | Browse | Overall |
|---|---|---|---|---|---|
| karpathy | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| blink    | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| rag      | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |
| qmd      | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ |

## Reference

For the production-scale benchmark comparing blink BM25 vs RAG over 3,890
GitHub issues (the benchmark cited in the v1.1.0 release and the project
README), see `examples/pathfinder/` and run:

```bash
cd examples/pathfinder
npm run ingest
npm run benchmark
```

That benchmark reports blink BM25 at ~4ms per query vs RAG at ~59ms, with
100% cache hit on repeat queries.
