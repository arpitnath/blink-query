# BLINK_WIKI.md

> Drop this file in your project root (or paste it into your agent's system prompt). It tells your LLM agent how to use blink-query as a wiki.

---

## 30-second mental model

This is [Karpathy's LLM wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) — a folder of markdown files the agent reads and updates — extended with typed records, path resolution, and an FTS5 index.

Same markdown files. Same ergonomics. Same "grep it if you want" escape hatch. The library adds:
- **Types** — each record has a consumption instruction (SUMMARY, META, SOURCE, ALIAS, COLLECTION)
- **Paths** — deterministic lookup by namespace/slug, no guessing filenames
- **Search** — BM25 full-text search across all records
- **Query DSL** — filter by type, tags, date, hit count
- **Lint** — find STALE, NXDOMAIN, and orphan records

Your wiki is still markdown on disk. blink-query is the resolution layer on top.

---

## Karpathy pattern → blink-query primitives

| Karpathy concept | blink-query primitive |
|---|---|
| Wiki page (overview, summary) | SUMMARY record |
| Entity page (structured attributes) | META record with JSON content |
| Source reference (paper, URL, spec) | SOURCE record |
| Cross-link `[[page title]]` | ALIAS record (auto-extracted on ingest) |
| `index.md` catalog | Auto-generated COLLECTION |
| `log.md` append entries | META records at `log/{date}/{slug}` |
| `grep` | `blink_search` (BM25/FTS5) |
| Read wiki page by filename | `blink_resolve` (deterministic O(1)) |

The difference: when you call `blink_resolve "wiki/mcp-protocol"`, you get back a typed record with a consumption instruction. When you call `blink_search "tool call handshake"`, you get ranked BM25 results across the full corpus. Both are faster than grepping a directory tree, and the types tell you what to do with the result without reading the full document first.

---

## Namespace conventions

Namespaces are slash-delimited paths. Use them to organize your wiki:

| Namespace | What goes here |
|---|---|
| `sources/` | SOURCE records for papers, URLs, specs, git files |
| `entity/` | META records for people, tools, concepts, projects |
| `log/{date}/` | Append-only META for research logs (date = `2026-04-08`) |
| `topics/` | SUMMARY records for processed topic overviews |
| `wiki/` | General wiki pages — summaries and notes |
| `config/` | META records for configuration and session state |

Examples:
- `sources/mcp-spec-2024` — the MCP protocol specification
- `entity/claude-desktop` — attributes of the Claude Desktop tool
- `log/2026-04-08/mcp-research-session` — today's research log entry
- `topics/tool-call-protocol` — a processed summary on tool calling
- `wiki/index` — your wiki's top-level index (auto-generated as COLLECTION)

You can use any namespace structure. The conventions above are a starting point.

---

## The five record types

Types are consumption instructions. The type tells you *how to use* the record — the content carries the domain meaning.

### SUMMARY

Read the summary directly. You have what you need.

Use for: processed wiki pages, topic overviews, entity descriptions that fit in a paragraph.

```
Path:    wiki/mcp-protocol
Type:    SUMMARY
Summary: MCP (Model Context Protocol) is a JSON-RPC 2.0 protocol for connecting
         LLM agents to tools and data sources. Connections are stateful sessions
         initiated by the client. Three transport types: stdio, SSE, streamable HTTP.
         Tool calls follow a request/response pattern with typed inputs and outputs.
Tags:    [mcp, protocol, tool-calling]
```

When you see a SUMMARY record, read the summary field. No need to fetch source files.

### META

Structured data. Parse the `content` field as JSON.

Use for: entity attributes, configuration, log entries, session state, anything that benefits from key-value structure.

```
Path:    entity/claude-desktop
Type:    META
Summary: Claude Desktop — Anthropic's macOS/Windows AI assistant with MCP support
Content: {
  "vendor": "Anthropic",
  "platforms": ["macOS", "Windows"],
  "mcp_support": true,
  "config_path": "~/Library/Application Support/Claude/claude_desktop_config.json",
  "transport": "stdio"
}
```

When you see META, check `content` for structured fields. The summary is a quick description; `content` has the data.

### SOURCE

Summary here, fetch the source if you need depth.

Use for: references to external documents — papers, web pages, git files, API specs — where you want a pointer and a quick description, but may need the full text sometimes.

```
Path:    sources/mcp-spec-2024
Type:    SOURCE
Summary: Official MCP specification from Anthropic, covering protocol design,
         transport types, capability negotiation, and tool/resource/prompt schemas.
         ~8000 words. Covers v2024-11-05 and v2025-03-26.
Content: https://spec.modelcontextprotocol.io/specification/
Tags:    [mcp, spec, official]
```

When you see SOURCE, the summary tells you whether you need the full document. Only fetch if the summary isn't enough.

### ALIAS

Follow the redirect to the target record.

Use for: cross-linking wiki pages, handling synonyms and renames. If your markdown contains `[[MCP Protocol]]`, blink-query auto-creates an ALIAS from `wiki/mcp-protocol` (slugified) to wherever you direct it.

```
Path:    wiki/model-context-protocol
Type:    ALIAS
Target:  wiki/mcp-protocol
```

When you see ALIAS, call `blink_resolve` on the target path. Or use `blink_resolve` directly on the alias path — it follows the chain automatically.

### COLLECTION

Browse children, pick what's relevant.

Use for: namespace indexes. When you resolve a namespace path that has no direct record, blink-query auto-generates a COLLECTION listing the child records.

```
Path:    sources
Type:    COLLECTION (auto-generated)
Summary: 12 records in namespace sources/
Content: [
  { path: "sources/mcp-spec-2024", type: "SOURCE", summary: "..." },
  { path: "sources/mcp-typescript-sdk", type: "SOURCE", summary: "..." },
  ...
]
```

When you see COLLECTION, scan the child summaries and resolve whichever looks relevant.

---

## How to ingest

### Bulk ingest (a directory of markdown files)

Use `blink_ingest` to ingest a folder. It reads all markdown files, derives namespaces from paths, and saves typed records.

```
blink_ingest({
  path: "./my-wiki",
  namespacePrefix: "wiki",
  preset: "WIKI_DERIVERS"
})
```

`WIKI_DERIVERS` is the preset for markdown wikis. It derives namespace from the file path, title from the first heading or filename, and type from the content structure. `[[wikilinks]]` are extracted as ALIAS records automatically.

### Single record

Use `blink_save` to save one record:

```
blink_save({
  namespace: "log/2026-04-08",
  title: "MCP research session",
  type: "META",
  summary: "Researched MCP ecosystem. Found 3 relevant SDKs. Key insight: ...",
  content: JSON.stringify({ sources_read: 4, next_steps: ["..."] }),
  tags: ["mcp", "research"]
})
```

---

## How to query

### Exact path lookup (fastest)

```
blink_resolve("wiki/mcp-protocol")
```

Returns the record at that path, or NXDOMAIN if it doesn't exist. Follows ALIAS chains. Auto-generates COLLECTION for namespace paths.

### Fuzzy search (BM25/FTS5)

```
blink_search("tool call protocol stdio transport")
```

Returns records ranked by BM25 relevance. Searches across title, summary, content, and tags.

### Browse a namespace

```
blink_list("sources", { limit: 20 })
```

Lists all records under a namespace prefix.

### Query DSL

```
blink_query('wiki where type = "SUMMARY" order by hit_count desc limit 10')
blink_query('sources where tags contains "mcp" and type = "SOURCE"')
blink_query('log/2026-04-08 where type = "META" order by created_at desc limit 5')
```

The DSL supports `=`, `!=`, `>`, `<`, `>=`, `<=`, `contains`, `in`, `AND`, `OR`, `NOT`, `since`, `order by`, `limit`, `offset`.

---

## How to log

Use append-only META records at `log/{date}/{slug}`. One record per source, session, or event.

```
blink_save({
  namespace: "log/2026-04-08",
  title: "anthropic-mcp-docs-read",
  type: "META",
  summary: "Read Anthropic's MCP documentation. Key findings: ...",
  content: JSON.stringify({
    url: "https://docs.anthropic.com/mcp",
    pages_read: 5,
    key_facts: ["fact 1", "fact 2"],
    follow_up: ["check SDK changelog"]
  }),
  tags: ["mcp", "anthropic", "log"]
})
```

To browse today's log: `blink_list("log/2026-04-08")`.
To search across all logs: `blink_query('log where type = "META" since "2026-04-01"')`.

---

## How to cross-reference

Use `[[wikilinks]]` in your markdown source. On ingest, blink-query extracts them and creates ALIAS records.

In `wiki/tool-calling.md`:
```markdown
Tool calling in MCP follows the [[MCP Protocol]] spec. See also [[Claude Desktop]] for how
clients implement it.
```

After ingesting, blink-query creates:
- `ALIAS wiki/mcp-protocol → wiki/mcp-protocol` (or wherever the target resolves)
- `ALIAS wiki/claude-desktop → entity/claude-desktop`

If the target doesn't exist yet, the ALIAS is created as NXDOMAIN — `blink wiki lint` will surface these for you to fill in.

You can also create cross-references manually:

```
blink_save({
  namespace: "wiki",
  title: "model-context-protocol",
  type: "ALIAS",
  content: "wiki/mcp-protocol"
})
```

---

## How to lint

```bash
blink wiki lint
```

Runs three checks:
1. **STALE** — records past their TTL that may need refreshing
2. **NXDOMAIN** — ALIAS records pointing to paths that don't exist
3. **Orphans** — records with no incoming links (may be intentional)

Fix stale records by re-ingesting the source or updating the summary. Fix NXDOMAIN aliases by creating the target record or updating the alias target.

---

## Worked examples

### Example 1: Research ingest

You've found 5 relevant documents on MCP. Ingest them as SOURCE records, then add a processed SUMMARY.

```
# Ingest a directory of downloaded markdown specs
blink_ingest({ path: "./mcp-docs", namespacePrefix: "sources", preset: "WIKI_DERIVERS" })

# Check what was ingested
blink_list("sources", { limit: 10 })

# Add a processed summary after reading
blink_save({
  namespace: "topics",
  title: "mcp-tool-calling",
  type: "SUMMARY",
  summary: "MCP tool calling uses JSON-RPC 2.0 request/response. Tools are declared in the server's capabilities response. Each call includes tool name, input schema, and returns typed content blocks. Error handling follows JSON-RPC error codes.",
  tags: ["mcp", "tool-calling"]
})
```

### Example 2: Q&A navigation

You need to answer a question about MCP transport types.

```
# Fast path: check if you have a direct record
blink_resolve("wiki/mcp-transports")
# → NXDOMAIN

# Fall back to search
blink_search("mcp transport stdio sse http")
# → returns sources/mcp-spec-2024 (SOURCE), topics/mcp-overview (SUMMARY)

# Read the SUMMARY first — it may be enough
blink_resolve("topics/mcp-overview")
# → SUMMARY with a paragraph on transports

# If you need more depth, check the SOURCE
blink_resolve("sources/mcp-spec-2024")
# → SOURCE with URL to fetch
```

### Example 3: Namespace navigation

You want to browse everything you know about MCP.

```
# Resolve the namespace — auto-generates a COLLECTION
blink_resolve("topics")
# → COLLECTION listing all topics/ records with summaries

# Drill into a specific area
blink_list("sources", { limit: 20 })

# Query for recent additions
blink_query('wiki where type = "SUMMARY" since "2026-04-01" order by created_at desc')
```

### Example 4: Lint after a session

You've finished a research session. Run lint to clean up.

```bash
blink wiki lint
```

Output:
```
STALE (2):
  sources/mcp-spec-2024 — TTL expired 2026-03-01 (last fetched 2026-01-15)
  entity/vscode-mcp — hit_count=0, not accessed since creation

NXDOMAIN (1):
  wiki/tool-call-examples → wiki/mcp-tool-calling (target missing)

Orphans (3):
  sources/anthropic-blog-2024 — no incoming links
  sources/openai-tool-use-docs — no incoming links
  log/2026-03-15/initial-research — no incoming links (logs are expected)
```

Fix the NXDOMAIN alias: `blink_save({ namespace: "wiki", title: "tool-call-examples", type: "ALIAS", content: "wiki/mcp-tool-calling" })`. Ignore the log orphans — log entries don't need incoming links.

---

## What this doesn't do (yet)

- **PDF ingestion** — coming in v2.1. For now, convert PDFs to markdown first.
- **Vector search** — blink-query uses BM25, not dense retrieval. If you need semantic similarity, add a RAG layer.
- **Sync / replication** — single local SQLite file. Use git to sync the markdown source across machines and re-ingest.
- **Automatic re-ingestion** — no filesystem watch. Run `blink wiki ingest` after updating source files.
- **Access control** — no auth, no multi-user. One agent, one wiki, one machine.

---

## Quick reference

| Task | Call |
|---|---|
| Ingest a directory | `blink_ingest({ path, namespacePrefix, preset: "WIKI_DERIVERS" })` |
| Save one record | `blink_save({ namespace, title, type, summary, content, tags })` |
| Exact lookup | `blink_resolve("namespace/slug")` |
| Fuzzy search | `blink_search("keywords")` |
| Browse namespace | `blink_list("namespace", { limit })` |
| Filter/sort | `blink_query('namespace where type = "SUMMARY" order by hit_count desc')` |
| Log an entry | `blink_save({ namespace: "log/YYYY-MM-DD", title, type: "META", ... })` |
| Lint the wiki | `blink wiki lint` (CLI) |
| Wikilink alias | `blink_save({ ..., type: "ALIAS", content: "target/path" })` |
