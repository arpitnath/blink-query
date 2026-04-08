# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2026-04-08

### Universal Benchmark and Search Improvements
- `npm run benchmark` — single-command reproducer that auto-clones three public markdown corpora (Quartz docs, Obsidian Help vault, MDN content) and runs blink-query against grep and ripgrep on the identical file set with verifiable per-query oracles
- `benchmark/` directory at the repo root: `bench.ts` single-corpus runner, `setup.ts` auto-clone, `run-all.ts` orchestrator with cross-corpus comparison and ASCII speedup bars, README, gitignored corpora and runtime artifacts
- Headline numbers from the universal config (one library configuration, no per-corpus tuning): blink-query is **25×–91× faster than grep** and **21×–31× faster than ripgrep** across the three corpora; **P@1 64% / P@3 79% average**

### Library improvements (5 patches that enable universal performance across corpus shapes)
- **Title-weighted BM25 with type-aware rank offsets** (`searchByKeywords`) — `bm25(records_fts, 10.0, 4.0, 1.0)`: title 10×, tags 4×, summary 1×, plus per-record-type rank offsets (SUMMARY −2.0, META −1.0, COLLECTION −0.5). Universal across markdown corpus shapes.
- **Hub-vs-leaf detection** (`loadDirectoryBasic`) — pre-walk pass tags every document with `is_canonical` (file is index/readme/home/about of its dir) and `is_hub` (canonical AND parent dir contains other subdirs). Additive metadata, zero breaking changes.
- **`defaultClassify`** (new exported function in `src/ingest.ts`) — promotes canonical hub pages to `SUMMARY` automatically using the structural signals from the walker. Frontmatter `type:` field still wins where present. Replaces the previous "everything is SOURCE" default when no `classify` callback is supplied.
- **`filesystemTitle` improvements** — for `index.md` / `README.md` / `Home.md` / `About.md` files, uses the parent directory name as the title. For date-style (Logseq) and UUID-style (Notion export) filenames, falls back to the first H1 in the document body. **Behavior change**: a previously-saved `docs/readme.md` now resolves to `docs/docs` instead of `docs/readme`.
- **`shortId()` 8 → 16 hex chars** — fixes `UNIQUE constraint failed: records.id` at ~14k records (32-bit IDs collided via birthday paradox at ~2.4% probability). 64-bit IDs push the threshold to ~4 billion records.

### How-to documentation
- `docs/USING_IN_PROJECT.md` — step-by-step library walkthrough: install, hello world, the five record types, five ingest patterns (folder/GitHub/Postgres/git/custom), querying (resolve/search/query/list), mutations, zones, where the data lives, common errors
- `docs/CONNECTING_TO_AGENT.md` — agent setup walkthrough: `blink init` flow, per-agent walkthroughs for Claude Desktop / Claude Code / Cursor / Codex, verification, dropping `BLINK_WIKI.md` into agent context, troubleshooting (nvm, Windows, JSON merge, empty results, doctor failures)

### Wiki Pattern Support
- `WIKI_DERIVERS` preset for ingesting markdown sources with namespace, title, type, and tag derivers
- `[[wikilink]]` extraction with auto ALIAS record creation on ingest
- `blink_ingest` MCP tool for bulk ingest from agent sessions
- Fix: `content` field now passes through for all record types (was gated to SOURCE only)

### Zones and Namespace Extension
- `Blink.createZone({ namespace, description, defaultTtl, requiredTags })` — register a zone with metadata. Records saved into the zone inherit the default TTL and must carry the required tags.
- `Blink.getZone(namespace)` — fetch a zone by namespace
- `blink_create_zone` MCP tool — lets agents carve out new namespaces for their workflows with enforced policies
- Migration: adds `required_tags` column to the `zones` table (idempotent, safe for existing databases)
- `createWikiNamespace(patterns)` factory — extend `WIKI_DERIVERS` with custom top-level directories (e.g. `decisions/`, `adr/`, `people/`) using a simple template syntax (`{dir}`, `{slug(dir)}`). Paths that don't match fall back to the default wiki routing.

### CLI Install UX
- `blink init` — auto-detects agent environment (Claude Desktop, Claude Code, Cursor, Codex) and writes MCP config
- `blink doctor` — post-install diagnostic: checks MCP config, database path, server connectivity
- `blink wiki init/ingest/lint` — subcommand group for wiki workflows

### Examples
- `examples/llm-wiki/` — end-to-end wiki on a 30-file MCP ecosystem corpus
- Retrieval comparison (`examples/llm-wiki/benchmark/`): grep vs blink BM25 over the same corpus, no external dependencies

### Documentation
- First `README.md` — "typed wiki for LLMs" framing, benchmark section, quick start, install guide
- `BLINK_WIKI.md` — schema document for LLM agents: namespace conventions, 5 record types, ingest/query/log/lint workflows, 4 worked example sessions

### Testing
- 524 tests across 24 suites (up from 388 across 17 in v1.1.0)
- New suites: wiki-derivers, wikilink-extraction, install, cli-wiki, zones, create-wiki-namespace, frontmatter
- Extended: mcp.test.ts with blink_ingest coverage
- vitest config excludes `.local/**` and `benchmark/**` from test discovery

## [1.1.0] - 2026-04-07

### Performance
- SQLite WAL mode and mmap pragmas for faster reads
- `skipIfUnchanged` deduplication on save (content-hash based)
- TTL-based eviction sweep for stale records
- Per-batch transaction flush in `saveMany()` (was single end-of-run transaction)

### Resolver
- `resolveCollection()` capped at 20 records per response (was unbounded)
- NXDOMAIN responses now include nearby-path suggestions for fuzzy navigation

### Adapters
- New GitHub Issues adapter (`loadFromGitHubIssues`, `ingestFromGitHub`)
- `GITHUB_DERIVERS` preset with namespace, title, tags, and source derivers

### MCP Server
- `limit` and `offset` pagination on `blink_list` and `blink_search`

### Examples
- New `examples/pathfinder/` — knowledge resolution agent powered by blink-query and pi-ai
- Multi-repo GitHub issues ingestion (Next.js, React, Vite, Svelte) with rule-based classifier
- Benchmark harness comparing blink BM25 vs RAG (vectra) — retrieval, full pipeline, and learning cache passes
- `agent-blink.ts` and `agent-rag.ts` demonstrating both approaches
- 17 evaluation questions covering direct lookup, namespace browse, keyword search, cross-repo

### Testing
- 388 tests across 17 suites (was 320 across 12)
- New: github-adapter, ingest-batch, mcp-pagination, resolver-scale, store-perf

## [1.0.0] - 2026-02-14

### Core
- DNS-inspired path resolution with 5 record types (SUMMARY, META, COLLECTION, SOURCE, ALIAS)
- Auto-COLLECTION generation when resolving namespace paths
- ALIAS chain resolution with loop detection (max 5 hops)
- TTL-based STALE detection on resolve
- SQLite storage via better-sqlite3, single-file embedded database

### Query DSL
- PEG-based query language: `namespace where field = 'value' order by field limit N offset M`
- Operators: `=`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `in`
- Boolean logic: `AND`, `OR` with parenthesized grouping
- `since` shorthand for date filtering

### Search
- FTS5 full-text search with porter stemming and unicode61 tokenization
- bm25 relevance ranking
- Namespace-scoped search with configurable limits

### Ingestion
- Directory ingestion with basic fs walker (LlamaIndex optional)
- PostgreSQL ingestion: classic SQL, progressive batched, and table shorthand
- Web URL ingestion with HTML stripping
- Git repository ingestion via git CLI
- LLM-powered summarization and classification (OpenAI-compatible API)
- Preset derivers: FILESYSTEM, POSTGRES, WEB, GIT
- Extractive summarizer (no API key needed)

### Validation
- Input validation layer (`src/validation.ts`) at save() boundary
- Namespace, title, TTL, content size (10MB), tags, RecordType validation
- PostgreSQL WHERE clause injection prevention
- Path traversal prevention

### MCP Server
- 9 tools: resolve, save, search, list, query, get, delete, move, zones
- Runtime RecordType validation
- Input length limits on all string parameters
- Stdio transport for AI agent connectivity

### CLI
- 9 commands: resolve, save, search, list, query, ingest, serve, zones, delete
- Commander-based with help text

### Testing
- 269 unit tests, 37 integration tests (vitest)
