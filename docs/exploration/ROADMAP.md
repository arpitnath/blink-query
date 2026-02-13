# Blink Query — Roadmap

All findings from the deep dive analysis, organized for tackling one by one.

Last updated: 2026-02-13

---

## A. Critical Fixes (Must Fix Before Publish)

### A1. SQL Injection in Query Executor — DONE
- **File**: `src/store.ts:393`
- **Fix**: Whitelisted allowed field names
- [x] Implement whitelist
- [x] Add test for rejected field names

### A2. Slug Collision — Silent Overwrites — DONE
- **Fix**: Collision detection with counter fallback
- [x] Add collision detection
- [x] Add test for slug collisions

### A3. Empty Slug from Emoji/Special-Char-Only Titles — DONE
- **Fix**: Fallback to UUID prefix when slug is empty
- [x] Add empty slug fallback
- [x] Add test for emoji-only titles

### A4. Binary File Crash in Ingestion — DONE
- **Fix**: try-catch in loadDirectoryBasic, skip non-UTF-8 files
- [x] Add try-catch in loadDirectoryBasic
- [x] Add test with binary file in fixtures

### A5. ALIAS Content Validation — DONE
- **Fix**: Validate ALIAS content on save, graceful handling in resolver
- [x] Add validation in save() for ALIAS type
- [x] Add graceful handling in resolver
- [x] Add test for malformed ALIAS

### A6. Version Mismatch — DONE
- **Fix**: Fixed version strings to match package.json
- [x] Fix version strings

---

## B. DX Improvements (Should Fix Before Publish)

### B1. Make `summarize` Optional in IngestOptions — DONE
- **Fix**: Defaults to `extractiveSummarize(500)` when not provided
- [x] Make summarize optional with default
- [x] Update tests

### B2. Document Path Slugification — DONE
- **Fix**: Added `blink.pathFor(namespace, title)` utility method
- [x] Add pathFor() method
- [ ] Document slug algorithm in README

### B3. Add `--json` Output Flag to CLI
- **File**: `src/index.ts`
- **Issue**: No machine-readable output. Blocks scripting use.
- [ ] Add --json flag
- [ ] Update all command handlers

### B4. Add `--db` Global CLI Flag
- **File**: `src/index.ts`
- **Issue**: CLI always uses default database. Can't use project-specific databases.
- [ ] Add --db flag
- [ ] Pass to Blink constructor

### B5. Add `:memory:` Mode to README
- [ ] Update README

### B6. Search Method — Use Options Object — DONE
- **Fix**: `search(keywords, { namespace?, limit? })`
- [x] Refactor search signature
- [x] Update CLI and MCP callers

### B7. Sync/Async Split Documentation
- [ ] Document in README

### B8. Error Communication Consistency
- [ ] Document error patterns
- [ ] Consider resolveOrThrow()

---

## C. Package & Publishing

### C1. Package Name Decision
- **Current**: `blink-query`
- [ ] Check npm availability
- [ ] Decide final name

### C2. npm Publish Readiness
- [x] All critical fixes (Section A) done
- [ ] README finalized with examples
- [x] ARCHITECTURE.md reviewed and updated
- [ ] `npm pack --dry-run` clean
- [ ] License file added
- [ ] CHANGELOG started

### C3. CJS Support
- [ ] Evaluate if CJS needed
- [ ] Add if yes

---

## D. Security & Validation

### D1. Input Validation Layer
- [ ] Reject namespaces with invalid chars (`#`, `?`, `%`, `..`)
- [ ] Reject empty/whitespace-only titles
- [ ] Reject negative TTL or TTL > MAX_SAFE_INTEGER
- [ ] Deduplicate tags before saving
- [ ] Add content size limit (e.g., 10MB)
- [ ] Validate Source objects in save()
- [ ] Validate RecordType at runtime in save() (not just TypeScript)

### D2. Path Traversal Prevention
- [ ] Sanitize namespace input
- [ ] Add tests

### D3. MCP Server Hardening
- [ ] Add runtime type validation
- [ ] Add tests for invalid MCP inputs

---

## E. Ingestion Pipeline Improvements

### E1. File Size Limit
- [ ] Add maxFileSize option
- [ ] Add test

### E2. Hidden File Handling
- [ ] Skip hidden files
- [ ] Add option to include

### E3. Empty File Handling
- [ ] Add empty file check
- [ ] Add test

### E4. Permission Error Handling — DONE
- [x] Add per-file error handling (try-catch in loadDirectoryBasic)

### E5. Progress Callback — PARTIALLY DONE
- [x] PostgreSQL progressive has `onBatch` callback
- [ ] Add onProgress to generic IngestOptions
- [ ] Wire into CLI output

### E6. Loader Metadata
- [ ] Update return type
- [ ] Update CLI to display loader used

### E7. Additional Text Extensions
- [ ] Add missing extensions

### E8. Summarize Timeout
- [ ] Add timeout support

---

## F. Data Source Layer — DONE

### F1. Web URL Ingestion — DONE
- [x] `loadFromUrls()` adapter + `stripHtml()` + `parseUrl()` helpers
- [x] `WEB_DERIVERS` preset (webNamespace, webTitle, webTags, webSources)
- [x] `blink.ingestFromUrls()` convenience method
- [x] 9 integration tests against real HTTP server
- [x] 23+ adapter unit tests

### F2. Git Repository Ingestion — DONE
- [x] `loadFromGit()` adapter using git CLI (zero npm deps)
- [x] `GIT_DERIVERS` preset (gitNamespace, gitTitle, gitTags, gitSources)
- [x] `blink.ingestFromGit()` convenience method
- [x] 9 integration tests against real git repo
- [x] File filtering, size limits, NaN guard

### F3. REST API Ingestion
- [ ] Design API
- [ ] Implement
- [ ] Tests

### F4. Database Ingestion — DONE
- [x] `loadFromPostgres()` classic adapter (full SQL)
- [x] `loadFromPostgresProgressive()` — batch loading with auto-detection
- [x] `introspectPostgresTable()` — schema introspection
- [x] `pickTextColumn()` — auto-detect text column
- [x] `POSTGRES_DERIVERS` preset
- [x] `blink.ingestFromPostgres()` and `blink.ingestFromPostgresProgressive()`
- [x] Progressive DX: 3-field config with auto-applied derivers
- [x] 19 integration tests against real PostgreSQL
- [x] 32+ adapter unit tests
- [x] Connection string sanitization (no password leaks)

### F5. Cloud Storage (LOW)
- [ ] Design API
- [ ] Implement
- [ ] Tests

### F6. LLM-Powered Ingestion — DONE
- [x] `llmSummarize()` factory → SummarizeCallback (OpenAI API)
- [x] `llmClassify()` factory → ClassifyCallback (OpenAI API)
- [x] Env-based config: `BLINK_LLM_PROVIDER`, `BLINK_LLM_MODEL`, `OPENAI_API_KEY`
- [x] Graceful fallback: extractiveSummarize on LLM error, SOURCE on classify error
- [x] 17 unit tests with mocked fetch

---

## G. Query DSL Enhancements

### G1. OR Operator (HIGH)
- [ ] Update PEG grammar
- [ ] Update query executor
- [ ] Tests

### G2. IN Operator (MEDIUM)
- [ ] Update grammar
- [ ] Update executor
- [ ] Tests

### G3. NOT Operator (MEDIUM)
- [ ] Update grammar
- [ ] Update executor
- [ ] Tests

### G4. FTS5 Migration (MEDIUM)
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
- [ ] Add offset to list()
- [ ] Add offset to query()
- [ ] Update CLI

### I2. Namespace Query Optimization
- [ ] Optimize query
- [ ] Benchmark

### I3. Streaming Ingestion — PARTIALLY DONE
- [x] PostgreSQL progressive has batched loading with LIMIT/OFFSET
- [ ] Design generic streaming API for other sources
- [ ] Tests

### I4. Nested Transaction Cleanup
- [ ] Refactor
- [ ] Tests

---

## J. Testing Gaps

### J1. Edge Case Tests Needed
- [x] Empty/whitespace-only titles (covered in slug tests)
- [x] Very long titles (>60 chars, slug truncation)
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

### Phase 1: Ship-Ready (Critical) — DONE
~~A1 → A2 → A3 → A4 → A5 → A6~~

### Phase 2: DX Polish — MOSTLY DONE
~~B1 → B2~~ → B5 → ~~B6~~ → B3 → B4 → B7 → B8

### Phase 3: Hardening
D1 → D2 → D3 → E1 → E2 → E3

### Phase 4: Package & Publish
C1 → C2 → C3 → J1

### Phase 5: Features
G1 → H1 → E5 → E6 → I1

### Phase 6: Data Sources — DONE
~~F1 → F2 → F4~~ → F3

### Phase 7: Advanced
G2 → G3 → G4 → I2 → I3 → I4 → F5
