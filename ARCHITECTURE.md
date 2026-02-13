# Blink Architecture

**DNS-inspired knowledge resolution layer for AI agents**

Version: 1.0.0 | Last Updated: 2026-02-13

---

## Overview

Blink is a knowledge resolution system that sits between **ingestion** (loading documents from any source) and **consumption** (AI agents querying knowledge). It stores typed knowledge records in SQLite and provides DNS-like resolution semantics.

```
                    ┌──────────────────────────────────────────┐
                    │           Data Sources                    │
                    │  Files  PostgreSQL  Web URLs  Git Repos  │
                    └────────────┬─────────────────────────────┘
                                 │
                    ┌────────────▼─────────────────────────────┐
                    │        Adapters (src/adapters.ts)         │
                    │  loadFromPostgres()  loadFromUrls()       │
                    │  loadFromGit()       loadDirectory()      │
                    │  introspectPostgresTable()                │
                    └────────────┬─────────────────────────────┘
                                 │  IngestDocument[]
                    ┌────────────▼─────────────────────────────┐
                    │     Ingestion Pipeline (src/ingest.ts)    │
                    │  Derivers → documentToSaveInput()         │
                    │  summarize() + classify() + deriveTags()  │
                    │  processDocuments() → blink.saveMany()    │
                    └────────────┬─────────────────────────────┘
                                 │  BlinkRecord[]
                    ┌────────────▼─────────────────────────────┐
                    │      Storage Layer (src/store.ts)         │
                    │  SQLite + better-sqlite3                  │
                    │  Records, Zones, Keywords                 │
                    └────────────┬─────────────────────────────┘
                                 │
              ┌──────────────────┼──────────────────────┐
              │                  │                      │
   ┌──────────▼───────┐  ┌──────▼──────────┐  ┌───────▼────────┐
   │   Resolution      │  │   Query Engine   │  │   MCP Server   │
   │  (resolver.ts)    │  │ (query-exec.ts)  │  │   (mcp.ts)     │
   │  resolve(path)    │  │  Peggy DSL →     │  │  5 stdio tools │
   │  ALIAS chains     │  │  SQLite WHERE    │  │  for AI agents │
   │  auto-COLLECTION  │  │                  │  │                │
   └───────────────────┘  └──────────────────┘  └────────────────┘
              │                  │                      │
              └──────────────────┼──────────────────────┘
                                 │
                    ┌────────────▼─────────────────────────────┐
                    │           AI Agents / CLI                 │
                    │  Library API (src/blink.ts)               │
                    │  CLI (src/index.ts)                       │
                    └──────────────────────────────────────────┘
```

**Core Innovation**: Type carries consumption instruction, content carries domain semantics. A `SUMMARY` record tells the agent "read this directly", while a `SOURCE` record says "fetch full content if needed".

---

## The 5 Record Types

| Type | Consumption Instruction | Use Case | Example |
|------|------------------------|----------|---------|
| **SUMMARY** | Read directly, no fetching needed | Key takeaways, TL;DRs | "Project roadmap Q1 highlights" |
| **META** | Structured configuration data | Settings, status, counts | `{ status: "active", contributors: 12 }` |
| **COLLECTION** | Browse children, pick what's relevant | Table of contents, listings | All docs in `projects/orpheus/*` |
| **SOURCE** | Summary here, fetch source if depth needed | Large docs, external APIs | 50KB file → 500 char summary + file_path |
| **ALIAS** | Follow redirect to target path | Shortcuts, renaming | `me/todo` → `tasks/personal/active` |

---

## System Components

### 1. Storage Layer (`src/store.ts`)

SQLite database with better-sqlite3 for Node.js compatibility.

#### Schema

```sql
CREATE TABLE records (
  id           TEXT PRIMARY KEY,
  path         TEXT UNIQUE NOT NULL,        -- DNS-like: "projects/orpheus/readme"
  namespace    TEXT NOT NULL,               -- First segment: "projects"
  title        TEXT NOT NULL,
  type         TEXT NOT NULL,               -- SUMMARY | META | COLLECTION | SOURCE | ALIAS
  summary      TEXT,
  content      TEXT,                        -- JSON-serialized
  ttl          INTEGER NOT NULL DEFAULT 2592000,
  content_hash TEXT NOT NULL,
  tags         TEXT DEFAULT '[]',           -- JSON array
  token_count  INTEGER DEFAULT 0,
  hit_count    INTEGER DEFAULT 0,
  last_hit     TEXT,
  sources      TEXT DEFAULT '[]',           -- JSON array of Source objects
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);

-- Indexes: namespace, type, updated_at, hit_count DESC

CREATE TABLE zones (
  path          TEXT PRIMARY KEY,
  description   TEXT,
  default_ttl   INTEGER DEFAULT 2592000,
  record_count  INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL,
  last_modified TEXT NOT NULL
);

CREATE TABLE keywords (
  keyword      TEXT NOT NULL,
  record_path  TEXT NOT NULL,
  PRIMARY KEY (keyword, record_path),
  FOREIGN KEY (record_path) REFERENCES records(path) ON DELETE CASCADE
);
```

#### Key Functions

| Function | Description |
|----------|-------------|
| `initDB(dbPath?)` | Initialize database with schema (`:memory:` supported) |
| `save(db, input)` | Upsert record (transaction-wrapped) |
| `saveMany(db, inputs[])` | Bulk save in single transaction |
| `getByPath(db, path)` | Direct lookup by path |
| `list(db, namespace, sort?)` | List records in namespace |
| `searchByKeywords(db, keywords[])` | Keyword-based search |
| `deleteRecord(db, path)` | Delete record (transaction-wrapped) |
| `move(db, from, to)` | Rename record (transaction-wrapped) |
| `slug(text)` | Unicode-aware slugification with fallback |

**Transaction safety**: All writes wrapped in `db.transaction()` for atomicity.

**Slug algorithm**: NFKD normalize → strip non-`[\p{L}\p{N}\s-]` → lowercase → hyphenate → max 60 chars → fallback to UUID prefix if empty.

---

### 2. Resolution Layer (`src/resolver.ts`)

DNS-inspired path resolution with intelligent record fetching.

```
resolve(path) →
  1. Lookup record by exact path
  2. Not found → return { status: 'NXDOMAIN' }
  3. TTL expired → return { status: 'STALE' }
  4. ALIAS → follow redirect chain (max 5 hops, detect loops → 'ALIAS_LOOP')
  5. Namespace query (no exact match) → auto-generate COLLECTION of children
  6. Increment hit_count, update last_hit
  7. Return { status: 'OK', record }
```

**Auto-COLLECTION**: Resolving `projects/orpheus` when it doesn't exist as a record but `projects/orpheus/*` records exist → auto-generates a COLLECTION listing all children (recent, max 100).

---

### 3. Query Engine (`src/query-executor.ts` + `src/grammar/query.peggy`)

SQL-like DSL parsed by Peggy PEG grammar.

```
Query    = Resource Clause*
Resource = [a-zA-Z_][a-zA-Z0-9_/]*     -- supports slashes: projects/orpheus
Clause   = Where | OrderBy | Limit | Since
Where    = "where" field op value
OrderBy  = "order by" field ("asc" | "desc")
Limit    = "limit" number
Since    = "since" ISO-date
```

**Operators**: `=`, `!=`, `>`, `<`, `>=`, `<=`, `contains`

```typescript
blink.query('projects where type = "SUMMARY" order by hit_count desc limit 5')
blink.query('me/tasks where tags contains "urgent" since 2026-02-01')
```

---

### 4. Ingestion Pipeline (`src/ingest.ts`)

Callback-first architecture for transforming documents from any source into Blink records.

#### Derivation Architecture

Every data source needs 4 derivation functions:

| Callback | Signature | Purpose |
|----------|-----------|---------|
| `deriveNamespace` | `(metadata) → string` | Path namespace (e.g., `public/articles`) |
| `deriveTitle` | `(metadata) → string` | Record title (e.g., article title) |
| `deriveTags` | `(metadata, extraTags?) → string[]` | Tags for search |
| `buildSources` | `(metadata) → Source[]` | Origin references |

#### Preset Deriver Sets

| Preset | Source Type | Namespace Pattern | Source.type |
|--------|-----------|-------------------|-------------|
| `FILESYSTEM_DERIVERS` | Local files | `dirname(file_path)` | `file` |
| `POSTGRES_DERIVERS` | PostgreSQL rows | `schema/table` | `database` |
| `WEB_DERIVERS` | Web pages | `web/hostname` | `web` |
| `GIT_DERIVERS` | Git repo files | `git/repo-name` | `vcs` |

Each deriver set exports both the combined preset object and individual functions for customization:

```typescript
// Use full preset
await blink.ingest(docs, { ...POSTGRES_DERIVERS });

// Mix and match
await blink.ingest(docs, {
  ...POSTGRES_DERIVERS,
  deriveTitle: (meta) => `custom-${meta.row_id}`,  // override just title
});
```

#### Ingestion Flow

```
IngestDocument[] → documentToSaveInput() for each:
  1. resolveNamespace(metadata, options)     — custom deriver or filesystem default
  2. deriveTitle(metadata)                   — custom deriver or filesystem default
  3. summarize(text, metadata)               — custom or extractiveSummarize(500)
  4. classify(text, metadata)                — custom or default SOURCE
  5. deriveTags(metadata, extraTags)         — custom or filesystem default
  6. buildSources(metadata)                  — custom or filesystem default
→ SaveInput[] → blink.saveMany() → BlinkRecord[]
```

**Concurrency**: Processes documents in batches of 5 (configurable via `options.concurrency`). Uses `Promise.allSettled` — errors are captured, not fatal.

#### Key Functions

| Function | Description |
|----------|-------------|
| `processDocuments(blink, docs, options)` | Main pipeline: map → derive → save |
| `documentToSaveInput(doc, options)` | Single document → SaveInput |
| `loadDirectory(dirPath, options?)` | LlamaIndex or basic fs walker |
| `extractiveSummarize(maxLength?)` | Default summarizer: first N chars at word boundary |

---

### 5. Adapters (`src/adapters.ts`)

Source-specific document loaders that produce `IngestDocument[]`.

#### PostgreSQL Adapter

**Classic** — full SQL control:
```typescript
const docs = await loadFromPostgres({
  connectionString: 'postgresql://localhost/mydb',
  query: 'SELECT * FROM articles WHERE published = true',
  textColumn: 'body',
  idColumn: 'id',
  titleColumn: 'title',
  table: 'articles',
});
```

**Progressive** — table shorthand with auto-detection:
```typescript
const docs = await loadFromPostgresProgressive({
  connectionString: 'postgresql://localhost/mydb',
  table: 'articles',
  batchSize: 100,
  // textColumn, idColumn auto-detected via introspection
  // where, maxRows, offset, onBatch optional
});
```

**Introspection**:
```typescript
const meta = await introspectPostgresTable(connStr, 'articles', 'public');
// → { columns: [...], primaryKey: 'id', rowCount: 5000, schema, database }

const textCol = pickTextColumn(meta);
// → auto-selects best text column (prefers 'text' type, then longest varchar)
```

**Security**: Connection strings are sanitized (passwords stripped) before storing in metadata.

**Dependency**: `pg` is an optional peer dependency, dynamically imported at runtime.

#### Web URL Adapter

```typescript
const docs = await loadFromUrls(
  ['https://example.com/docs/api', 'https://example.com/docs/guide'],
  { concurrency: 3, timeout: 10_000 }
);
```

- Fetches pages concurrently in batches
- HTML: strips `<script>`/`<style>`, extracts `<title>`, strips tags → plain text
- Non-HTML: uses body as-is
- Failed fetches are skipped with warning (not fatal)
- Custom `extractText(html, url)` callback supported

**Utilities exported**: `stripHtml(html)`, `parseUrl(url)`

#### Git Repository Adapter

```typescript
const docs = await loadFromGit({
  repoPath: '/path/to/repo',
  ref: 'HEAD',
  include: ['src/**/*.ts'],
  exclude: ['node_modules/**', '.git/**', 'dist/**'],
  maxFileSize: 100_000,
});
```

- Uses `git ls-tree` + `git show` via child_process (zero npm dependencies)
- Default excludes: `node_modules/**`, `.git/**`, `dist/**`, `*.lock`, `package-lock.json`
- Default includes: 30+ text file extensions (`.ts`, `.js`, `.py`, `.md`, etc.)
- NaN guard on file size parse
- Produces metadata: `{ repo, ref, file_path, file_name, file_type, commit_sha }`

---

### 6. LLM Helpers (`src/llm.ts`)

Factory functions that produce `SummarizeCallback` and `ClassifyCallback` using LLM APIs.

```typescript
import { llmSummarize, llmClassify } from 'blink-query';

await blink.ingest(docs, {
  summarize: llmSummarize({ apiKey: 'sk-...' }),
  classify: llmClassify(),
});
```

#### Configuration Resolution (priority order)

1. Explicit config parameter (`{ apiKey, model, provider }`)
2. Environment variables: `OPENAI_API_KEY`, `BLINK_LLM_MODEL`, `BLINK_LLM_PROVIDER`
3. Defaults: `provider: 'openai'`, `model: 'gpt-5-mini-2025-08-07'`, `temperature: 0.3`

#### Graceful Degradation

- `llmSummarize()` falls back to `extractiveSummarize(500)` on API error
- `llmClassify()` defaults to `'SOURCE'` on API error
- Both log warnings to stderr

---

### 7. Library API (`src/blink.ts`)

Public API wrapping all layers. This is the npm entry point.

```typescript
class Blink {
  constructor(options?: { dbPath?: string })

  // CRUD
  save(input: SaveInput): BlinkRecord
  saveMany(inputs: SaveInput[]): BlinkRecord[]
  get(path: string): BlinkRecord | null
  delete(path: string): boolean
  move(from: string, to: string): BlinkRecord | null

  // Resolution & Query
  resolve(path: string): ResolveResponse
  search(keywords: string, options?: { namespace?, limit? }): BlinkRecord[]
  list(namespace: string, sort?: 'recent' | 'hits' | 'title'): BlinkRecord[]
  query(queryString: string): BlinkRecord[]
  zones(): Zone[]
  pathFor(namespace: string, title: string): string

  // Ingestion — Generic
  async ingest(docs: IngestDocument[], options: IngestOptions): Promise<IngestResult>
  async ingestDirectory(dirPath, options, loadOptions?): Promise<IngestResult>

  // Ingestion — PostgreSQL
  async ingestFromPostgres(config: PostgresLoadConfig, options: IngestOptions): Promise<IngestResult>
  async ingestFromPostgresProgressive(
    config: PostgresProgressiveConfig,
    options?: IngestOptions,    // optional — auto-applies POSTGRES_DERIVERS + extractiveSummarize
  ): Promise<IngestResult & { introspection: PostgresIntrospection }>

  // Ingestion — Web & Git
  async ingestFromUrls(urls, options, loadOptions?): Promise<IngestResult>
  async ingestFromGit(config: GitLoadConfig, options: IngestOptions): Promise<IngestResult>

  close(): void
}
```

**Progressive DX**: `ingestFromPostgresProgressive` with no options auto-applies `POSTGRES_DERIVERS` + `extractiveSummarize(500)`, enabling minimal usage:

```typescript
// 3-field ingestion — everything else auto-detected
await blink.ingestFromPostgresProgressive({
  connectionString: 'postgresql://localhost/mydb',
  table: 'articles',
  batchSize: 100,
});
```

#### Exports

```typescript
// Types
export type {
  BlinkRecord, SaveInput, Zone, ResolveResponse, RecordType, Source,
  QueryAST, QueryCondition,
  IngestDocument, IngestOptions, IngestResult,
  SummarizeCallback, ClassifyCallback,
  DeriveNamespaceCallback, DeriveTitleCallback, DeriveTagsCallback, BuildSourcesCallback,
  PostgresLoadConfig, PostgresProgressiveConfig, PostgresIntrospection, PostgresColumnInfo,
  PostgresBatchCallback,
  WebLoadConfig, GitLoadConfig, LLMConfig,
}

// Derivers
export {
  FILESYSTEM_DERIVERS, filesystemNamespace, filesystemTitle, filesystemTags, filesystemSources,
  POSTGRES_DERIVERS,   postgresNamespace,   postgresTitle,   postgresTags,   postgresSources,
  WEB_DERIVERS,        webNamespace,        webTitle,        webTags,        webSources,
  GIT_DERIVERS,        gitNamespace,        gitTitle,        gitTags,        gitSources,
}

// Adapters & Utilities
export { loadFromPostgres, loadFromPostgresProgressive, loadFromUrls, loadFromGit }
export { introspectPostgresTable, pickTextColumn, stripHtml, parseUrl }
export { loadDirectory, extractiveSummarize }
export { llmSummarize, llmClassify }
```

---

### 8. CLI (`src/index.ts`)

Commander-based CLI with 10 commands.

| Command | Description |
|---------|-------------|
| `save` | Save a knowledge record |
| `resolve <path>` | Resolve a path to typed record |
| `list <namespace>` | List records in namespace |
| `search <keywords...>` | Keyword search |
| `query <querystring>` | Execute Blink query DSL |
| `zones` | List all zones with stats |
| `delete <path>` | Delete a record |
| `move <from> <to>` | Move/rename a record |
| `ingest <directory>` | Ingest files from directory |
| `serve` | Start MCP server (stdio) |

---

### 9. MCP Server (`src/mcp.ts`)

Model Context Protocol server for AI agent integration via stdio transport.

| Tool | Description |
|------|-------------|
| `blink_resolve` | Resolve a path |
| `blink_save` | Save a record |
| `blink_search` | Keyword search |
| `blink_list` | List namespace |
| `blink_query` | Execute query DSL |

---

## Source Type System

The `Source` interface tracks where knowledge originated:

```typescript
interface Source {
  type: 'web' | 'file' | 'database' | 'api' | 'vcs' | string;
  url?: string;              // web sources
  file_path?: string;        // file sources
  connection_string?: string; // database sources (sanitized, no passwords)
  table?: string;            // database sources
  query?: string;            // database sources
  endpoint?: string;         // API sources
  method?: string;           // API sources
  repo?: string;             // VCS sources
  ref?: string;              // VCS sources
  last_fetched?: string;     // timestamp
  [key: string]: unknown;    // extensible
}
```

---

## Data Flow Examples

### Example 1: PostgreSQL → Blink (Progressive, Zero-Config)

```typescript
const blink = new Blink();

// Auto-detects PK, text column, title column, metadata — no SQL needed
const result = await blink.ingestFromPostgresProgressive({
  connectionString: 'postgresql://localhost/mydb',
  table: 'articles',
  batchSize: 100,
});

console.log(result.introspection.primaryKey);   // 'id'
console.log(result.introspection.columns);      // full column metadata
console.log(result.records.length);             // ingested count
```

### Example 2: Web Scraping → Blink

```typescript
const blink = new Blink();

const result = await blink.ingestFromUrls(
  ['https://docs.example.com/api', 'https://docs.example.com/guide'],
  { ...WEB_DERIVERS, summarize: llmSummarize() },
);
// Records: web/docs-example-com/api, web/docs-example-com/guide
```

### Example 3: Git Repo → Blink

```typescript
const blink = new Blink();

const result = await blink.ingestFromGit(
  { repoPath: '/path/to/repo', include: ['src/**/*.ts'] },
  { ...GIT_DERIVERS },
);
// Records: git/repo-name/src/index, git/repo-name/src/utils, ...
```

### Example 4: Agent Resolution

```typescript
const response = blink.resolve('projects/orpheus');

if (response.status === 'OK' && response.record.type === 'COLLECTION') {
  const children = response.record.content;
  // Agent sees list of all documents in projects/orpheus/*
}
```

### Example 5: Query DSL

```typescript
const tasks = blink.query(
  'tasks/personal where tags contains "urgent" since 2026-02-10 order by created_at desc'
);
```

---

## Build & Package

### Build Configuration (`tsup.config.ts`)

Two entry points:

1. **Library** (`src/blink.ts`) → `dist/blink.js` + `dist/blink.d.ts`
2. **CLI** (`src/index.ts`) → `dist/index.js` (with shebang)

**Externals**: `better-sqlite3`, `llamaindex`, `@llamaindex/readers`, `pg`

### Package Exports

```json
{
  "main": "dist/blink.js",
  "types": "dist/blink.d.ts",
  "exports": {
    ".": { "import": "./dist/blink.js", "types": "./dist/blink.d.ts" },
    "./cli": "./dist/index.js"
  },
  "bin": { "blink": "dist/index.js" }
}
```

### Dependencies

| Package | Type | Purpose |
|---------|------|---------|
| `better-sqlite3` | dependency | SQLite engine |
| `commander` | dependency | CLI framework |
| `@modelcontextprotocol/sdk` | dependency | MCP server |
| `llamaindex` | optional peer | Full format document loading |
| `@llamaindex/readers` | optional peer | Directory reader |
| `pg` | optional peer | PostgreSQL adapter |

---

## Testing

**214 tests** across 12 test suites using Vitest:

| Suite | Tests | Coverage |
|-------|-------|----------|
| `store.test.ts` | 21 | CRUD, transactions, keywords, zones, slug |
| `resolver.test.ts` | 8 | Resolution, ALIAS, auto-COLLECTION, TTL |
| `query-parser.test.ts` | 13 | PEG grammar, slashed namespaces |
| `query-executor.test.ts` | 9 | WHERE, ORDER BY, LIMIT, SINCE |
| `ingest.test.ts` | 17 | Document mapping, summarizer, batch processing |
| `ingest-integration.test.ts` | 6 | Real file loading, fallback loader |
| `derivers.test.ts` | 54 | All 4 deriver sets (filesystem, postgres, web, git) |
| `adapters.test.ts` | 32 | PostgreSQL, web, git adapters + introspection |
| `llm.test.ts` | 17 | LLM summarizer/classifier, env config, fallbacks |
| `postgres.integration.test.ts` | 19 | Real PostgreSQL (introspection, progressive, classic) |
| `web.integration.test.ts` | 9 | Real HTTP server, HTML/JSON, timeouts |
| `git.integration.test.ts` | 9 | Real git repo, refs, file filtering |

```bash
npm test              # Unit tests only (177)
npm run test:integration  # Integration tests only (37)
npm run test:all      # All tests (214)
```

---

## Key Design Decisions

### 1. Why SQLite?
Embedded, zero-config, ACID transactions, portable single file. No server to manage.

### 2. Why better-sqlite3?
Node.js ecosystem compatibility. Synchronous API for simpler transaction handling. Production-tested.

### 3. Why callback-first derivation?
Different data sources need different logic for namespace, title, tags, and sources. Preset deriver sets provide good defaults; individual callbacks allow surgical customization without forking.

### 4. Why 5 types only?
Type = consumption instruction, not domain type. Prevents type explosion. Forces clarity: "how should the agent consume this?" not "what is this about?"

### 5. Why DNS-inspired?
Hierarchical namespaces, ALIAS redirects, TTL freshness, zones. Familiar mental model for developers.

### 6. Why optional peer dependencies?
Users without PDF/PostgreSQL/etc needs shouldn't install heavy deps. Dynamic import + fallback = graceful degradation.

### 7. Why progressive PostgreSQL?
The classic adapter requires raw SQL + 7 config fields. Progressive disclosure: Level 1 (3 fields, auto-detect everything), Level 2 (where/maxRows/offset), Level 3 (full SQL). Schema introspection via `information_schema` enables auto-detection.

---

## Performance Characteristics

| Operation | Time |
|-----------|------|
| Bulk save (50K records, transaction) | 2-8 seconds |
| Direct path lookup | ~1ms |
| Auto-COLLECTION | ~5-10ms |
| ALIAS chain (3 hops) | ~3ms |
| Keyword search (3 terms) | ~10-20ms |
| Query DSL | ~15-30ms |

---

## Architecture Principles

1. **Type = Consumption Instruction** — Separates "how to use" from "what it is"
2. **Transactions = Atomicity** — All writes wrapped for consistency
3. **Callbacks = Extensibility** — Developer brings summarizer, classifier, derivers
4. **Preset Derivers = DX** — Sensible defaults per source type, override surgically
5. **Optional Deps = Flexibility** — Works with or without LlamaIndex, pg, etc.
6. **DNS Semantics = Familiarity** — Paths, aliases, TTL, zones
7. **Progressive Disclosure** — Simple things simple, complex things possible

---

## File Map

```
src/
├── blink.ts            # Public API (Blink class), npm entry point
├── store.ts            # SQLite CRUD, zones, keyword indexing, transactions
├── resolver.ts         # Path resolution, ALIAS chains, auto-COLLECTION
├── query-executor.ts   # Peggy DSL → SQLite WHERE queries
├── ingest.ts           # Derivers, document mapping, batch processing
├── adapters.ts         # PostgreSQL, Web, Git loaders + introspection
├── llm.ts              # LLM summarizer/classifier factories
├── mcp.ts              # MCP server (5 tools, stdio transport)
├── index.ts            # CLI (commander, 10 commands)
├── types.ts            # All TypeScript interfaces and type definitions
└── grammar/
    └── query.peggy     # PEG grammar for query DSL

tests/
├── store.test.ts
├── resolver.test.ts
├── query-parser.test.ts
├── query-executor.test.ts
├── ingest.test.ts
├── ingest-integration.test.ts
├── derivers.test.ts
├── adapters.test.ts
├── llm.test.ts
└── integration/
    ├── postgres.integration.test.ts
    ├── web.integration.test.ts
    └── git.integration.test.ts

test-agent/             # Standalone demo scripts (Anthropic SDK + MCP)
├── postgres-test.ts
├── web-test.ts
└── git-test.ts
```
