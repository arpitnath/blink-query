# Changelog

All notable changes to this project will be documented in this file.

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
