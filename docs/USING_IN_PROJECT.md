# Using blink-query in your project

A walkthrough for adding blink-query to your own app, CLI, or script. No agent integration here — for that see [`CONNECTING_TO_AGENT.md`](CONNECTING_TO_AGENT.md).

---

## Install

```bash
npm install blink-query
```

Requirements: Node.js 18+ and macOS / Linux / Windows. The library bundles `better-sqlite3` so there's nothing else to install.

---

## Hello world

```typescript
import { Blink } from 'blink-query';

const blink = new Blink({ dbPath: './my-wiki.db' });

// Save a record
blink.save({
  namespace: 'projects',
  title: 'Orpheus',
  type: 'SUMMARY',
  summary: 'A model-runner service for local LLMs. Multi-server architecture, session affinity.',
  tags: ['service', 'oss'],
});

// Resolve by path — deterministic O(1) lookup
const record = blink.resolve('projects/orpheus');
console.log(record.status, record.record?.summary);
// → OK A model-runner service for local LLMs...

// Search — title-weighted BM25
const hits = blink.search('orpheus model runner');
console.log(hits.map(r => r.path));

blink.close();
```

That's the entire surface for basic use. Save → resolve → search.

---

## The five record types

The type is a *consumption instruction* — it tells the agent how to use the record, not what it's about.

| Type | When to use | Agent behavior |
|---|---|---|
| **SUMMARY** | Canonical "what is X" pages, processed wiki entries | Read `summary`, you have the answer |
| **META** | Configuration, log entries, structured state, frontmatter-heavy files | Parse `content` as JSON |
| **SOURCE** | References to external docs, URLs, git files, papers | Read `summary` first; fetch the source if you need depth |
| **ALIAS** | Cross-links between concepts; auto-generated from `[[wikilinks]]` on ingest | Follow the redirect to the target record |
| **COLLECTION** | Namespace indexes (auto-generated for namespaces with no direct record) | Browse children; pick what's relevant |

Full schema and worked examples in [`BLINK_WIKI.md`](../BLINK_WIKI.md).

---

## Common patterns

### Pattern 1: ingest a folder of markdown notes

```typescript
import { Blink } from 'blink-query';

const blink = new Blink({ dbPath: './wiki.db' });

const result = await blink.ingestDirectory('./my-notes', {
  namespacePrefix: 'wiki',
});

console.log(`ingested ${result.records.length} records, ${result.errors.length} errors`);

// Now query
const hits = blink.search('typescript generics');
```

`ingestDirectory` walks the directory recursively, parses YAML frontmatter on `.md` files, derives namespaces from the directory structure, and uses the library's `defaultClassify` to type each record. No further configuration needed for most cases.

If your folder structure is `wiki/concepts/auth.md`, the record gets `namespace: wiki/concepts`, `title: auth`, `path: wiki/concepts/auth`.

### Pattern 2: ingest GitHub Issues

```typescript
import { Blink, GITHUB_DERIVERS } from 'blink-query';

const blink = new Blink({ dbPath: './issues.db' });

await blink.ingestFromGitHub(
  {
    owner: 'vercel',
    repo: 'next.js',
    state: 'open',
    labels: ['bug'],
    maxIssues: 500,
  },
  GITHUB_DERIVERS,
);

// Each issue becomes a typed record
const bugs = blink.query('vercel/next.js where tags contains "bug" limit 10');
```

Requires a GitHub token in `GITHUB_TOKEN` env var.

### Pattern 3: ingest PostgreSQL rows

```typescript
import { Blink, POSTGRES_DERIVERS } from 'blink-query';

const blink = new Blink({ dbPath: './pg-mirror.db' });

await blink.ingestFromPostgres(
  {
    connectionString: 'postgres://...',
    table: 'documents',
    textColumn: 'body',
    idColumn: 'id',
  },
  POSTGRES_DERIVERS,
);
```

For larger tables use `ingestFromPostgresProgressive` which auto-detects columns and ingests in batches.

### Pattern 4: ingest a git repo's docs

```typescript
import { Blink, GIT_DERIVERS } from 'blink-query';

const blink = new Blink({ dbPath: './gitdocs.db' });

await blink.ingestFromGit(
  {
    repo: 'https://github.com/obsidianmd/obsidian-help.git',
    subdir: 'en',
    extensions: ['.md'],
  },
  GIT_DERIVERS,
);
```

Clones the repo to a temp directory, walks the subdir, ingests markdown files. The repo gets cleaned up after.

### Pattern 5: write your own classifier

The library's defaults handle most corpora, but you can override any deriver:

```typescript
import { Blink, RecordType } from 'blink-query';

await blink.ingestDirectory('./my-corpus', {
  classify: (text, metadata): RecordType => {
    const fn = (metadata.file_name as string).toLowerCase();
    if (fn === 'config.yaml' || fn === 'package.json') return 'META';
    if (fn.startsWith('howto-')) return 'SUMMARY';
    if (fn.startsWith('ref-')) return 'SOURCE';
    return 'SOURCE';
  },
  summarize: async (text) => {
    // Your own summarizer — could be an LLM call, an extractive summarizer, anything
    return text.slice(0, 800);
  },
  deriveNamespace: (metadata) => {
    const path = metadata.file_path as string;
    return `mycorpus/${path.split('/')[0]}`;
  },
});
```

The default classifier (`defaultClassify`) reads `metadata.is_hub` from the directory walk and promotes canonical hub pages (`index.md` / `README.md` whose parent dir contains other subdirs) to `SUMMARY`. For most corpora this is enough.

---

## Querying

Four ways to read records, in order of preference:

### 1. `resolve(path)` — deterministic O(1) lookup

```typescript
const response = blink.resolve('wiki/mcp-protocol');
// response.status = 'OK' | 'NXDOMAIN' | 'STALE' | 'ALIAS_LOOP'
if (response.status === 'OK') {
  console.log(response.record.summary);
}
```

Fastest path. Use when you know the exact namespace + slug.

### 2. `search(keywords)` — title-weighted BM25 over typed records

```typescript
const hits = blink.search('how to configure auth');
// returns top-10 ranked records (or pass { limit: N })
```

Title matches are weighted 10× over body matches. SUMMARY-typed records get a rank boost. Use when you have a natural-language query.

### 3. `query(dsl)` — Peggy-parsed query DSL

```typescript
// All SUMMARY records in the wiki namespace, sorted by hit count
const top = blink.query('wiki where type = "SUMMARY" order by hit_count desc limit 10');

// Records tagged with "bug" updated in the last day
const recent = blink.query('issues where tags contains "bug" since "1 day ago"');
```

Use for structured filters, sorting, range conditions. The DSL grammar is in `src/grammar/query.peggy`.

### 4. `list(namespace, sort?)` — namespace browsing

```typescript
const records = blink.list('wiki/concepts', 'recent', { limit: 20 });
```

Use to enumerate everything in a namespace.

---

## Mutations

```typescript
// Create or update (idempotent on path)
blink.save({
  namespace: 'wiki/concepts',
  title: 'OAuth Flow',
  type: 'SUMMARY',
  summary: '...',
  tags: ['auth'],
});

// Move
blink.move('wiki/concepts/old-name', 'wiki/concepts/new-name');

// Delete
blink.delete('wiki/concepts/outdated');
```

All synchronous. Wrapped in transactions internally — partial failures don't leave the DB in a half-state.

---

## Zones (namespace metadata)

A zone is a top-level namespace with declared metadata: a description, a default TTL, and optional required tags. Records saved into a zone inherit its defaults and must include any required tags.

```typescript
blink.createZone({
  namespace: 'decisions',
  description: 'Architecture decision records',
  defaultTtl: 31536000, // 1 year in seconds
  requiredTags: ['adr'],
});

// This now succeeds with the inherited TTL and validated tags
blink.save({
  namespace: 'decisions',
  title: 'Use SQLite for the index',
  type: 'META',
  tags: ['adr', 'storage'],
});

// This throws — missing required tag
blink.save({
  namespace: 'decisions',
  title: 'Use Redis for cache',
  type: 'META',
  tags: ['storage'], // missing 'adr'
});
```

List zones: `blink.zones()`. Get one: `blink.getZone('decisions')`.

---

## Where the data lives

```typescript
const blink = new Blink({ dbPath: './wiki.db' });
```

The path is just a SQLite file. You can:

- **Open it directly** with any SQLite client (`sqlite3 wiki.db`) and inspect the `records` table
- **Back it up** with `cp wiki.db wiki.db.bak` (better-sqlite3 supports `db.backup()` for online backups)
- **Gitignore it** — `wiki.db` is binary, doesn't merge well, regenerable from your markdown source
- **Default location**: if you don't pass `dbPath`, blink uses `~/.blink/blink.db`

For the MCP server use case, the env var `BLINK_DB_PATH` sets the location. See [`CONNECTING_TO_AGENT.md`](CONNECTING_TO_AGENT.md).

---

## Lifecycle

```typescript
const blink = new Blink({ dbPath: './wiki.db' });

try {
  // ... your operations
} finally {
  blink.close();
}
```

`Blink` holds a SQLite handle. Call `close()` when you're done. In a long-running process (server, CLI daemon), keep one instance for the lifetime of the process.

---

## Common errors

### `Error: Namespace cannot contain ..`

You passed a namespace with `..` in it (path traversal guard). Most often this happens when you derive a namespace from a directory containing literal `..` in the name (e.g., MDN's `for...in`). Sanitize: `dir.replace(/\.\.+/g, '_')`.

### `SqliteError: UNIQUE constraint failed: records.id`

Pre-v2.0.0 issue with 8-char IDs at large scale. Fixed in v2.0.0 (`shortId` extended to 16 hex chars). Upgrade.

### `Error: Required tag missing`

You saved a record into a zone that requires tags you didn't include. Either add the missing tag to your `tags: [...]` array, or change the zone's `requiredTags`.

### `blink.search()` returns nothing for an obvious match

Three things to check:
1. Did you actually call `ingest` first? `blink.list('your/namespace')` should show records.
2. Are your records' titles meaningful? If every file is `index.md`, run with the library's default `filesystemTitle` which uses parent-dir name.
3. Title weight is 10× body weight. If your query terms are only in the body, search results may rank by something else.

### Resolve returns `STALE`

The record's TTL has expired. Either re-ingest or save a fresh version. STALE doesn't mean the record is gone — `response.record` still has the data, you just know it's old.

---

## Where to go next

- [`BLINK_WIKI.md`](../BLINK_WIKI.md) — full schema doc and worked examples for using blink-query as an LLM wiki
- [`examples/llm-wiki/`](../examples/llm-wiki/) — a runnable end-to-end example: 30-file MCP ecosystem corpus
- [`benchmark/README.md`](../benchmark/README.md) — methodology and reference numbers for the universal benchmark
- [`CONNECTING_TO_AGENT.md`](CONNECTING_TO_AGENT.md) — plug blink-query into Claude Desktop / Code / Cursor / Codex
