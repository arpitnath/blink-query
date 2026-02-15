# Blink

**DNS-inspired knowledge resolution layer for AI agents**

[![Tests](https://img.shields.io/badge/tests-320%20passing-success)]() [![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)]() [![License](https://img.shields.io/badge/license-MIT-blue)]() [![npm](https://img.shields.io/npm/v/blink-query)]()

Blink sits between your data and your AI agent. It turns documents from anywhere — files, databases, web pages, git repos — into typed knowledge records with DNS-like resolution semantics.

```
Your Data → [Load → Store → Find] → Your Agent
```

---

## Quick Start

### Installation

```bash
npm install blink-query

# Optional: for PDF/DOCX support
npm install llamaindex @llamaindex/readers

# Optional: for PostgreSQL ingestion
npm install pg
```

### Library API

```typescript
import { Blink, extractiveSummarize } from 'blink-query';

const blink = new Blink();

// Ingest a directory
await blink.ingestDirectory('./docs', {
  summarize: extractiveSummarize(500),
  namespacePrefix: 'knowledge'
});

// Resolve knowledge
const response = blink.resolve('knowledge/readme');
console.log(response.record.summary);

// Query with DSL
const results = blink.query('knowledge where type = "SUMMARY" limit 5');

// Search
const found = blink.search('authentication jwt');

blink.close();
```

### CLI

```bash
# Ingest files
blink ingest ./my-docs --prefix knowledge --tags "v1,docs"

# Resolve a path
blink resolve knowledge/readme

# Search
blink search "authentication api"

# Query with DSL
blink query 'knowledge where tags contains "urgent" order by hit_count desc'

# List records in a namespace
blink list knowledge --limit 20 --offset 0

# Manage zones
blink zones

# Move and delete
blink move knowledge/old-path knowledge/new-path
blink delete knowledge/outdated-doc
```

All CLI commands support `--json` for machine-readable output and `--db` to target a specific database file.

### MCP Server (for AI agents)

```bash
blink serve
# AI agent connects via stdio MCP protocol
```

9 tools available: `blink_resolve`, `blink_save`, `blink_search`, `blink_list`, `blink_query`, `blink_get`, `blink_delete`, `blink_move`, `blink_zones`.

### In-Memory Mode (for testing)

```typescript
const blink = new Blink({ dbPath: ':memory:' });
```

---

## The 5 Record Types

| Type | What it tells the agent | Example |
|------|------------------------|---------|
| **SUMMARY** | Read this directly, you have what you need | Project overview, meeting notes |
| **META** | Structured data, parse it | `{ status: "active", contributors: 12 }` |
| **COLLECTION** | Browse children, pick what's relevant | Table of contents, directory listings |
| **SOURCE** | Summary here, fetch source if you need depth | Large files, external APIs |
| **ALIAS** | Follow the redirect to the real record | Shortcuts, renames |

**Core innovation**: Type carries consumption instruction, content carries domain semantics.

---

## Data Sources

### Directory Ingestion

```typescript
await blink.ingestDirectory('./docs', {
  summarize: extractiveSummarize(500),
  namespacePrefix: 'docs',
  maxFileSize: 1048576,    // 1MB limit (default)
  includeHidden: false,     // skip dotfiles (default)
  onProgress: ({ current, total, file }) => {
    console.log(`${current}/${total}: ${file}`);
  }
});
```

Supports 50+ file extensions out of the box. Skips empty files, hidden files, and files over the size limit automatically.

### PostgreSQL Ingestion

```typescript
await blink.ingestFromPostgres({
  connectionString: 'postgresql://localhost/mydb',
  query: 'SELECT id, title, body FROM articles',
  textColumn: 'body',
  idColumn: 'id',
  titleColumn: 'title'
});
```

### Web Ingestion

```typescript
import { loadFromWeb } from 'blink-query';

const docs = await loadFromWeb([
  'https://example.com/docs/getting-started',
  'https://example.com/docs/api-reference'
]);
await blink.ingest(docs, { namespacePrefix: 'web' });
```

### Git Ingestion

```typescript
import { loadFromGit } from 'blink-query';

const docs = await loadFromGit({
  repoPath: '/path/to/repo',
  ref: 'main',
  extensions: ['.md', '.ts']
});
await blink.ingest(docs, { namespacePrefix: 'repo' });
```

### LLM-Powered Summarization

```typescript
import { Blink, configureLLM } from 'blink-query';

// Configure via environment variables:
// BLINK_LLM_PROVIDER=openai
// BLINK_LLM_MODEL=gpt-4o-mini
// OPENAI_API_KEY=...

const summarize = configureLLM();

await blink.ingestDirectory('./docs', {
  summarize,
  namespacePrefix: 'knowledge'
});
```

Or bring your own summarizer:

```typescript
await blink.ingest(docs, {
  summarize: async (text, metadata) => {
    // Call any LLM, return a string
    return await myLLM.summarize(text);
  }
});
```

---

## Query DSL

SQL-like query language for filtering records:

```
namespace where field op value [and|or condition] [order by field asc|desc] [limit N] [offset N] [since "date"]
```

### Examples

```bash
# Filter by type
blink query 'docs where type = "SUMMARY"'

# Tag search
blink query 'projects where tags contains "urgent" order by hit_count desc'

# Boolean logic
blink query 'docs where type = "SOURCE" and hit_count > 10'

# NOT operator
blink query 'docs where not type = "ALIAS"'

# IN operator
blink query 'docs where type in ("SUMMARY", "META")'

# Pagination
blink query 'docs where type = "SUMMARY" limit 10 offset 20'

# Date filtering
blink query 'docs since "2026-01-01"'
```

---

## Resolution

```typescript
const response = blink.resolve('projects/orpheus/readme');

switch (response.status) {
  case 'OK':        // Record found
  case 'STALE':     // Record found but TTL expired
  case 'NXDOMAIN':  // Not found
  case 'ALIAS_LOOP': // Circular alias detected
}
```

Resolution follows DNS semantics:
- Direct path lookup
- ALIAS chains (up to 5 hops)
- Auto-COLLECTION: resolving a namespace generates a listing of child records
- TTL expiry: records past their TTL return with STALE status

---

## API Design

All CRUD operations are **synchronous** — no `await` needed:

| Method | Returns | Description |
|--------|---------|-------------|
| `resolve(path)` | `{ status, record }` | DNS-like path resolution |
| `get(path)` | `record \| null` | Direct lookup |
| `save(input)` | `record` | Create or update |
| `delete(path)` | `boolean` | Remove a record |
| `move(from, to)` | `record \| null` | Move/rename |
| `search(query)` | `record[]` | FTS5 keyword search |
| `list(namespace)` | `record[]` | List records in namespace |
| `query(dsl)` | `record[]` | Query DSL filtering |

Only ingestion methods (`ingest`, `ingestDirectory`, `ingestFromPostgres`) are async.

### Error Handling

- `resolve()` returns a status object — check `status` before using `record`
- `get()` returns `null` if the path doesn't exist
- `delete()` returns `false` if the record wasn't found
- `move()` returns `null` if the source doesn't exist
- `query()` throws on invalid query syntax
- `save()` throws on invalid input (e.g., ALIAS without target)

---

## Input Validation

All input is validated at the save boundary:

- Namespaces: no path traversal (`..`), no special characters (`#`, `?`, `%`)
- Titles: non-empty, trimmed
- Content: max 10MB
- Tags: deduplicated, cleaned
- Record types: must be one of the 5 valid types
- PostgreSQL WHERE clauses: checked for injection patterns

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Blink System                           │
├─────────────┬───────────────┬──────────────┬───────────────┤
│  Ingestion  │    Storage    │  Resolution  │  Consumption  │
│             │               │              │               │
│ Directory   │  SQLite DB    │  Resolver    │   Library     │
│ PostgreSQL  │  FTS5 Search  │  Query DSL   │   CLI         │
│ Web / Git   │  Transactions │  Auto-COLL   │   MCP Server  │
│ LLM Summary│  Zones        │  ALIAS chain │   JSON output │
└─────────────┴───────────────┴──────────────┴───────────────┘
```

See [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) for a full plain-language guide.

---

## Development

```bash
# Install dependencies
npm install

# Build (parser + library + CLI)
npm run build

# Run tests (excludes integration tests)
npm test

# Run all tests (including PostgreSQL integration)
npm run test:all

# Build PEG parser only
npm run build:parser

# Pack for inspection before publishing
npm pack --dry-run

# CLI (dev mode)
node dist/index.js --help
```

---

## Use Cases

- **Agent memory** — Store conversation context with semantic types
- **Project knowledge base** — Ingest codebases, docs, wikis
- **API caching** — Cache API responses with TTL
- **Research notes** — Structure knowledge with namespaces
- **Configuration** — Store settings as META records

---

## License

MIT — see [LICENSE](./LICENSE)

---

**Questions?** [Open an issue](https://github.com/arpitnath/blink-query/issues) or read the [architecture docs](./docs/ARCHITECTURE.md).
