# Blink Query — Roadmap

All findings from the deep dive analysis, organized for tackling one by one.

Last updated: 2026-02-13

---

## A. Critical Fixes (Must Fix Before Publish)

### A1. SQL Injection in Query Executor
- **File**: `src/store.ts:393`
- **Issue**: Field names from query conditions are interpolated directly into SQL: `sql += \` AND ${cond.field} ${cond.op} ?\``
- **Risk**: If a malicious query gets past the parser, field names are injectable
- **Fix**: Whitelist allowed field names (`type`, `title`, `namespace`, `path`, `hit_count`, `token_count`, `ttl`, `tags`)
- [ ] Implement whitelist
- [ ] Add test for rejected field names

### A2. Slug Collision — Silent Overwrites
- **File**: `src/store.ts:235`
- **Issue**: Different titles can produce same slug. `"Foo!"` and `"foo?"` both → `foo`. Second save silently overwrites first.
- **Fix**: Detect collision where existing record has a different title → either throw error or auto-append counter (`foo-2`)
- [ ] Add collision detection
- [ ] Add test for slug collisions

### A3. Empty Slug from Emoji/Special-Char-Only Titles
- **File**: `src/store.ts:69`
- **Issue**: `slug('🎉🎊!!!')` returns empty string → fails UNIQUE constraint or creates broken path
- **Fix**: Fallback to generated ID when slug is empty
- [ ] Add empty slug fallback
- [ ] Add test for emoji-only titles

### A4. Binary File Crash in Ingestion
- **File**: `src/ingest.ts:195`
- **Issue**: `readFile(fullPath, 'utf-8')` on binary files produces garbage or throws
- **Fix**: Wrap in try-catch, skip files that fail to read as UTF-8
- [ ] Add try-catch in loadDirectoryBasic
- [ ] Add test with binary file in fixtures

### A5. ALIAS Content Validation
- **File**: `src/resolver.ts:27-29`
- **Issue**: If ALIAS record has null/malformed content (missing `target`), resolver crashes
- **Fix**: Validate ALIAS content on save, return specific error status on resolve
- [ ] Add validation in save() for ALIAS type
- [ ] Add graceful handling in resolver
- [ ] Add test for malformed ALIAS

### A6. Version Mismatch
- **File**: `src/index.ts:13`, `src/mcp.ts:93`
- **Issue**: CLI reports `0.1.0`, MCP server reports `0.1.0`, but package.json says `1.0.0`
- **Fix**: Read version from package.json or keep in sync
- [ ] Fix version strings

---

## B. DX Improvements (Should Fix Before Publish)

### B1. Make `summarize` Optional in IngestOptions
- **File**: `src/types.ts:98`
- **Issue**: `summarize` is required even for simplest ingestion. Forces extra import.
- **Fix**: Default to `extractiveSummarize(500)` when not provided
- **Before**: `blink.ingest(docs, { summarize: extractiveSummarize(500) })`
- **After**: `blink.ingest(docs, {})` or `blink.ingest(docs)`
- [ ] Make summarize optional with default
- [ ] Update tests

### B2. Document Path Slugification
- **Issue**: Users don't know `"Hello World"` becomes `hello-world`. #1 predicted support question.
- **Fix**: Add `blink.pathFor(namespace, title)` utility method AND document slug rules
- [ ] Add pathFor() method
- [ ] Document slug algorithm in README

### B3. Add `--json` Output Flag to CLI
- **File**: `src/index.ts`
- **Issue**: No machine-readable output. Blocks scripting use.
- **Fix**: Add global `--json` flag, output JSON for all commands
- [ ] Add --json flag
- [ ] Update all command handlers

### B4. Add `--db` Global CLI Flag
- **File**: `src/index.ts`
- **Issue**: CLI always uses default database. Can't use project-specific databases.
- **Fix**: Add `--db <path>` global option
- [ ] Add --db flag
- [ ] Pass to Blink constructor

### B5. Add `:memory:` Mode to README
- **Issue**: Quick experimentation pattern not documented
- **Fix**: Add `new Blink({ dbPath: ':memory:' })` to Quick Start
- [ ] Update README

### B6. Search Method — Use Options Object
- **File**: `src/blink.ts:34-37`
- **Issue**: `search(keywords, namespace?, limit?)` — positional optionals are fragile
- **Fix**: `search(keywords, { namespace?, limit? })`
- [ ] Refactor search signature
- [ ] Update CLI and MCP callers

### B7. Sync/Async Split Documentation
- **Issue**: All CRUD is sync, only ingestion is async. Not documented anywhere.
- **Fix**: Add note in README: "All CRUD operations are synchronous. Only ingestion is async."
- [ ] Document in README

### B8. Error Communication Consistency
- **Issue**: `resolve()` returns status codes, `query()` throws, `delete()` returns boolean, `move()` returns null
- **Fix**: Document the error contract clearly. Consider `resolveOrThrow()` convenience method.
- [ ] Document error patterns
- [ ] Consider resolveOrThrow()

---

## C. Package & Publishing

### C1. Package Name Decision
- **Current**: `blink-query` — misleading, sounds like query builder
- **Options**:
  1. `blink` — best if available on npm
  2. `blink-resolve` — captures DNS metaphor
  3. `@blink/core` — scoped, extensible
- [ ] Check npm availability
- [ ] Decide final name

### C2. npm Publish Readiness
- [ ] All critical fixes (Section A) done
- [ ] README finalized with examples
- [ ] ARCHITECTURE.md reviewed
- [ ] `npm pack --dry-run` clean
- [ ] License file added
- [ ] CHANGELOG started

### C3. CJS Support
- **Issue**: Only ESM exports currently. Some Node.js users still on CJS.
- **Fix**: Add `require` field in exports map or dual build
- [ ] Evaluate if CJS needed
- [ ] Add if yes

---

## D. Security & Validation

### D1. Input Validation Layer
- **Issue**: No runtime validation for namespace format, title length, TTL bounds, content size
- **Items**:
  - [ ] Reject namespaces with invalid chars (`#`, `?`, `%`, `..`)
  - [ ] Reject empty/whitespace-only titles
  - [ ] Reject negative TTL or TTL > MAX_SAFE_INTEGER
  - [ ] Deduplicate tags before saving
  - [ ] Add content size limit (e.g., 10MB)
  - [ ] Validate Source objects in save()
  - [ ] Validate RecordType at runtime in save() (not just TypeScript)

### D2. Path Traversal Prevention
- **Issue**: No validation that namespace doesn't contain `..` or absolute paths
- [ ] Sanitize namespace input
- [ ] Add tests

### D3. MCP Server Hardening
- **File**: `src/mcp.ts:117`
- **Issue**: Type assertion bypasses validation: `as string as any`
- **Fix**: Validate RecordType before coercing
- [ ] Add runtime type validation
- [ ] Add tests for invalid MCP inputs

---

## E. Ingestion Pipeline Improvements

### E1. File Size Limit
- **File**: `src/ingest.ts` — `loadDirectoryBasic()`
- **Issue**: No max file size. 100MB files will OOM.
- **Fix**: Add `maxFileSize` option (default 10MB), skip larger files with warning
- [ ] Add maxFileSize option
- [ ] Add test

### E2. Hidden File Handling
- **Issue**: Files like `.env`, `.git/config` are currently ingested
- **Fix**: Skip files starting with `.` by default, add `includeHidden` option
- [ ] Skip hidden files
- [ ] Add option to include

### E3. Empty File Handling
- **Issue**: Empty files create records with empty text/summary
- **Fix**: Skip files with empty content, or create META record with just metadata
- [ ] Add empty file check
- [ ] Add test

### E4. Permission Error Handling
- **Issue**: `readFile()` can throw EACCES, crashes entire directory walk
- **Fix**: Catch per-file errors, continue walking, report in IngestResult
- [ ] Add per-file error handling
- [ ] Add test

### E5. Progress Callback
- **Issue**: No feedback during large ingests (10K+ files)
- **Fix**: Add optional `onProgress: (current, total) => void` to IngestOptions
- [ ] Add onProgress callback
- [ ] Wire into CLI output

### E6. Loader Metadata
- **Issue**: Users don't know which loader (LlamaIndex vs basic-fs) was used
- **Fix**: Return `{ docs, loader: 'llamaindex' | 'basic-fs' }` from loadDirectory
- [ ] Update return type
- [ ] Update CLI to display loader used

### E7. Additional Text Extensions
- **Missing**: `.rst`, `.tex`, `.kt`, `.swift`, `.scala`, `.r`, `.lua`, `.dockerfile`
- [ ] Add missing extensions

### E8. Summarize Timeout
- **Issue**: Async summarize callbacks can hang indefinitely (no timeout)
- **Fix**: Add `timeout` option to IngestOptions, abort after N ms
- [ ] Add timeout support

---

## F. Data Source Layer — New Sources

### F1. Web URL Ingestion (HIGH)
```typescript
await blink.ingestURL('https://docs.example.com', {
  summarize: mySummarizer,
  maxDepth: 2,
  selectors: { content: 'article', ignore: '.sidebar' }
});
```
- Uses cheerio for HTML parsing, undici for fetch
- Stores `sources: [{ type: 'web', url, last_fetched }]`
- [ ] Design API
- [ ] Implement
- [ ] Tests

### F2. Git Repository Ingestion (HIGH)
```typescript
await blink.ingestGitRepo('https://github.com/user/repo', {
  branch: 'main',
  paths: ['docs/', 'src/'],
  summarize: mySummarizer
});
```
- Clone to temp dir or use GitHub API
- Store commit SHA for versioning
- [ ] Design API
- [ ] Implement
- [ ] Tests

### F3. REST API Ingestion (MEDIUM)
```typescript
await blink.ingestAPI('https://api.example.com/docs', {
  headers: { Authorization: 'Bearer token' },
  paginate: { next: 'response.next_page' },
  summarize: mySummarizer
});
```
- [ ] Design API
- [ ] Implement
- [ ] Tests

### F4. Database Ingestion (MEDIUM)
```typescript
await blink.ingestDatabase({
  type: 'postgres',
  connection: 'postgresql://...',
  query: 'SELECT id, title, content FROM articles',
  summarize: mySummarizer
});
```
- [ ] Design API
- [ ] Implement with adapters
- [ ] Tests

### F5. Cloud Storage (LOW)
- S3, GCS support
- [ ] Design API
- [ ] Implement
- [ ] Tests

---

## G. Query DSL Enhancements

### G1. OR Operator (HIGH)
```
projects where type = 'SUMMARY' OR type = 'META'
```
- [ ] Update PEG grammar
- [ ] Update query executor
- [ ] Tests

### G2. IN Operator (MEDIUM)
```
projects where type IN ('SUMMARY', 'META')
```
- [ ] Update grammar
- [ ] Update executor
- [ ] Tests

### G3. NOT Operator (MEDIUM)
```
projects where NOT tags contains 'archived'
```
- [ ] Update grammar
- [ ] Update executor
- [ ] Tests

### G4. FTS5 Migration (MEDIUM)
- **Issue**: Keyword search uses LIKE `%term%`, not proper full-text search
- **Fix**: Migrate keywords table to SQLite FTS5 virtual table
- [ ] Design migration
- [ ] Implement
- [ ] Performance benchmark
- [ ] Tests

---

## H. MCP Server Enhancements

### H1. Add Missing Tools
- [ ] `blink_delete` — Delete records
- [ ] `blink_move` — Move/rename records
- [ ] `blink_zones` — List all zones

### H2. Tool Schema Improvements
- [ ] Validate RecordType at runtime (not just `as any`)
- [ ] Better error messages for invalid inputs

---

## I. Scalability & Performance

### I1. Pagination
- **Issue**: `list()` and `query()` load all results into memory
- **Fix**: Add `offset`/`cursor` parameter for pagination
- [ ] Add offset to list()
- [ ] Add offset to query()
- [ ] Update CLI

### I2. Namespace Query Optimization
- **File**: `store.ts:300`
- **Issue**: `namespace LIKE ?` doesn't use index efficiently
- **Fix**: Use `namespace >= ? AND namespace < ?` for range scan
- [ ] Optimize query
- [ ] Benchmark

### I3. Streaming Ingestion
- **Issue**: Loading 50K files into memory array at once
- **Fix**: Stream batches: `for await (const batch of loadDirectoryStreaming(dir, { batchSize: 100 }))`
- [ ] Design streaming API
- [ ] Implement
- [ ] Tests

### I4. Nested Transaction Cleanup
- **File**: `store.ts:359`
- **Issue**: `saveMany()` wraps `save()` which has its own transaction → nested transactions via savepoints
- **Fix**: Extract non-transactional save logic into helper, call from both
- [ ] Refactor
- [ ] Tests

---

## J. Testing Gaps

### J1. Edge Case Tests Needed
- [ ] Empty/whitespace-only titles
- [ ] Very long titles (>60 chars)
- [ ] Duplicate slugs from different titles
- [ ] ALIAS pointing to non-existent target
- [ ] ALIAS with null/undefined content
- [ ] Circular ALIAS chains with exactly 5 hops (boundary)
- [ ] Unicode/emoji in paths and namespaces
- [ ] Empty files in loadDirectoryBasic
- [ ] Huge files (>10MB)
- [ ] Concurrent writes to same path
- [ ] SQL reserved keywords as namespace/title
- [ ] Query with invalid field names
- [ ] Zone count accuracy after delete/move
- [ ] Search with empty keywords `blink.search('')`

---

## K. Blog & Positioning

### K1. Strongest Blog Angles
1. **"Your AI Agent Has a Resolution Problem, Not a Memory Problem"** — type-aware consumption vs blind vector search
2. **"DNS for AI: What Network Infrastructure Teaches Us About Agent Memory"** — the metaphor deep dive
3. **"Zero to AI Knowledge Base in 60 Seconds"** — no API keys, no Docker, no config
4. **"Why 5 Types Instead of 500"** — designing consumption instructions, not domain types
5. **"Building an MCP Server in 150 Lines"** — appeals to MCP ecosystem

### K2. Competitive Positioning
| vs What | Blink's Angle |
|---------|---------------|
| Vector DBs (Pinecone, Chroma) | Deterministic resolution > probabilistic retrieval |
| LangChain Memory | Typed knowledge > raw message history |
| Mem0 | Embedded + free > cloud SaaS |
| Raw SQLite | DNS semantics + type system > bare key-value |

### K3. Key Demo Ideas
- "Ask your codebase" agent — ingest repo, navigate via COLLECTION → SOURCE → SUMMARY
- Personal knowledge assistant — notes + bookmarks + configs with type-aware resolution
- MCP playground — connect Blink to Claude Desktop

### K4. What Blink is NOT (say explicitly)
- Not a vector database
- Not a conversation memory store
- Not a full-text search engine
- Not a graph database
- Not a multi-tenant cloud service

---

## Priority Order (Suggested)

### Phase 1: Ship-Ready (Critical)
A1 → A2 → A3 → A4 → A5 → A6

### Phase 2: DX Polish
B1 → B2 → B5 → B6 → B3 → B4 → B7 → B8

### Phase 3: Hardening
D1 → D2 → D3 → E1 → E2 → E3 → E4

### Phase 4: Package & Publish
C1 → C2 → C3 → J1

### Phase 5: Features
G1 → H1 → E5 → E6 → I1

### Phase 6: Data Sources
F1 → F2 → F3

### Phase 7: Advanced
G2 → G3 → G4 → I2 → I3 → I4 → F4 → F5
