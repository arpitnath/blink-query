# Blink

**DNS-inspired knowledge resolution layer for AI agents**

[![Tests](https://img.shields.io/badge/tests-66%20passing-success)]() [![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)]() [![License](https://img.shields.io/badge/license-MIT-blue)]()

Blink sits between document ingestion (LlamaIndex) and AI agent consumption. It stores typed knowledge records with DNS-like resolution semantics.

```
Files/APIs → [Ingestion] → Blink Records → [Resolution] → AI Agents
```

---

## Quick Start

### Installation

```bash
npm install blink-query

# Optional: for PDF/DOCX support
npm install llamaindex @llamaindex/readers
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

# Query
blink query 'knowledge where tags contains "urgent" order by hit_count desc'
```

### MCP Server (for AI agents)

```bash
blink serve
# AI agent connects via stdio MCP protocol
```

---

## The 5 Record Types

| Type | Description | Example |
|------|-------------|---------|
| **SUMMARY** | Read directly, no fetching | "Project roadmap Q1 2026 highlights" |
| **META** | Structured metadata | `{ status: "active", contributors: 12 }` |
| **COLLECTION** | List of child records | Table of contents, directory listings |
| **SOURCE** | Summary + pointer to full content | Large files, external APIs |
| **ALIAS** | Redirect to another path | Shortcuts, renames |

**Core innovation**: Type carries consumption instruction, content carries domain semantics.

---

## Features

- **DNS-inspired paths** — `projects/orpheus/readme`
- **Auto-COLLECTION** — Resolving a namespace auto-generates child list
- **ALIAS redirects** — Like DNS CNAME or symlinks
- **TTL/freshness** — Records expire after configurable time
- **Keyword search** — Full-text search with SQLite FTS
- **Query DSL** — SQL-like filtering: `where`, `order by`, `limit`, `since`
- **File ingestion** — Load docs from disk with LlamaIndex or basic fs walker
- **Transaction safety** — All writes atomic via SQLite transactions
- **MCP server** — AI agents connect via Model Context Protocol

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Blink System                           │
├─────────────┬───────────────┬──────────────┬───────────────┤
│  Ingestion  │    Storage    │  Resolution  │  Consumption  │
│             │               │              │               │
│ LlamaIndex  │  SQLite DB    │  Resolver    │   Library     │
│ Basic FS    │  better-sqlite│  Query DSL   │   CLI         │
│ Custom      │  Transactions │  Auto-COLL   │   MCP Server  │
└─────────────┴───────────────┴──────────────┴───────────────┘
```

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full system design.

---

## Examples

### Ingest with LLM Summarizer

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { Blink, loadDirectory } from 'blink-query';

const anthropic = new Anthropic();
const blink = new Blink();

// Load docs from disk
const docs = await loadDirectory('./my-project');

// Ingest with Claude summaries
await blink.ingest(docs, {
  summarize: async (text, metadata) => {
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 200,
      messages: [{ role: 'user', content: `Summarize: ${text.slice(0, 4000)}` }]
    });
    return response.content[0].text;
  },
  classify: (text, metadata) => {
    // Classify based on file type
    if (metadata.file_name === 'README.md') return 'SUMMARY';
    if (metadata.file_type === '.json') return 'META';
    return 'SOURCE';
  }
});
```

### Resolution in AI Agent

```typescript
const response = blink.resolve('projects/orpheus');

if (response.status === 'OK') {
  const record = response.record;

  if (record.type === 'SUMMARY') {
    // Direct consumption
    console.log(record.summary);
  } else if (record.type === 'SOURCE') {
    // Check summary, fetch full content if needed
    console.log(record.summary);
    const fullContent = await fetchFromSource(record.sources[0]);
  } else if (record.type === 'COLLECTION') {
    // Browse children
    const children = record.content as Array<{ path: string, title: string }>;
    console.log(`Contains ${children.length} documents`);
  }
}
```

---

## Development

```bash
# Install
npm install

# Build
npm run build

# Test
npm test

# CLI (dev)
node dist/index.js --help
```

---

## Use Cases

- **Agent memory** — Store conversation context with semantic types
- **Project knowledge base** — Ingest codebases, docs, wikis
- **API caching** — Cache API responses with TTL
- **Task management** — Organize tasks with COLLECTION records
- **Research notes** — Structure knowledge with namespaces
- **Configuration** — Store settings as META records

---

## Performance

- **Bulk ingestion**: 50K records in 2-8 seconds (with transactions)
- **Resolution**: ~1ms direct lookup, ~5-10ms auto-COLLECTION
- **Search**: ~10-20ms keyword search with 3 terms
- **Database**: Embedded SQLite, single file, zero config

---

## Positioning

Blink is a **resolution layer**, not:
- ❌ Vector database (use Pinecone/Weaviate)
- ❌ Document store (use MongoDB)
- ❌ Full-text search engine (use Elasticsearch)
- ❌ Graph database (use Neo4j)

Blink is lightweight, fast, and focused on typed knowledge resolution for AI agents.

---

## License

MIT

---

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Full system design
- [CLAUDE.md](./CLAUDE.md) — Capsule Kit integration (for Claude Code)
- [`/test-agent/`](./test-agent/) — Usage examples with Anthropic SDK

---

**Questions?** Open an issue or check the [architecture docs](./ARCHITECTURE.md).
