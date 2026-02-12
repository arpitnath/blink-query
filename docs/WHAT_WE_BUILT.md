# Blink MVP — What We Built & How It Works

**Date:** February 2026
**Status:** Working MVP — ready for validation

---

## The Problem

AI systems today have broken memory. You re-explain yourself to every tool. Research evaporates between sessions. Context is siloed, fragmented, and owned by platforms — not by you.

No existing system provides **structured + typed + queryable + fresh + portable** memory for AI systems.

## The Insight

DNS solved a similar coordination problem for the internet 40 years ago. Flat `/etc/hosts` files didn't scale. DNS introduced hierarchical naming, record types, caching, TTLs, and a resolution protocol.

AI tools today are at the `/etc/hosts` stage. Each maintains its own flat memory. There's no shared naming system, no resolution protocol, no record types.

**Blink applies DNS architecture to knowledge resolution for AI tools.**

## What Blink Is

A local server that stores your knowledge as **typed records** in SQLite, organized in **hierarchical namespaces**, queryable via a **custom DSL**, and exposed to AI tools via **MCP**.

```
Agent → Blink (MCP) → Resolve path → Typed Record
                                          │
                            ┌──────────────┼──────────────┐
                            ▼              ▼              ▼
                        SUMMARY         META          SOURCE
                       "read this"   "follow these   "fetch here
                                      as rules"     if you need more"
```

**The core innovation:** Record types tell LLMs **HOW** to consume knowledge — not just what it is. A SUMMARY says "read it, you're done." A META says "these are rules, follow them." A COLLECTION says "browse and pick." The agent never guesses.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Blink Server                     │
│               (single Bun process)                │
│                                                   │
│  ┌─────────┐  ┌───────────┐  ┌──────┐           │
│  │   CLI   │  │ MCP Server│  │Query │           │
│  │(commander)│ │  (stdio)  │  │(Peggy)│          │
│  └────┬────┘  └─────┬─────┘  └──┬───┘           │
│       └─────────────┼───────────┘                │
│                     ▼                             │
│  ┌──────────────────────────────────────────┐    │
│  │           Resolution Engine               │    │
│  │  Path → Record (ALIAS chain, auto-COLL)   │    │
│  └──────────────────┬───────────────────────┘    │
│                     ▼                             │
│  ┌──────────────────────────────────────────┐    │
│  │           SQLite Store (bun:sqlite)       │    │
│  │  records | zones | keywords               │    │
│  └──────────────────────────────────────────┘    │
└─────────────────────────────────────────────────┘
```

### Data Flow

```
SAVE:   Input → slug(title) → path → store in SQLite → extract keywords → index
RESOLVE: Path → check for record → follow ALIAS chain → increment hits → return typed record
QUERY:   DSL string → Peggy parser → AST → SQL translation → SQLite → results
SEARCH:  Keywords → keyword index JOIN → ranked by match count + hits → results
```

---

## Components

### 1. Record Types (5 types)

The DNS-inspired core. Each type carries behavioral semantics:

| Type | What It Returns | Agent Instruction |
|------|----------------|-------------------|
| **SUMMARY** | Pre-processed text | "Read this. You have what you need." |
| **META** | Structured key-value data | "These are rules. Follow them." |
| **COLLECTION** | List of child records | "Browse these. Pick what's relevant." |
| **SOURCE** | Pointer to file/URL + summary | "Summary is here. Fetch source if you need depth." |
| **ALIAS** | Redirect to another path | "Follow this. Topics evolve, paths don't break." |

### 2. Namespace Hierarchy

Knowledge lives in a navigable tree:

```
blink/
├── me/                         → WHO YOU ARE
│   ├── background              → SUMMARY: career, skills, experience
│   └── preferences             → META: coding style, tools, conventions
├── projects/                   → WHAT YOU'RE BUILDING
│   └── orpheus/
│       ├── architecture        → SUMMARY: system design
│       └── conventions         → META: coding standards
├── discoveries/                → WHAT YOU'VE LEARNED
│   └── pattern/
│       └── jwt-auth-pattern    → SUMMARY: JWT auth approach
└── research/                   → INVESTIGATIONS
    └── nosql                   → ALIAS → discoveries/pattern/jwt-auth-pattern
```

### 3. Zone SOA

Every top-level namespace is a **zone** with metadata:

```
me/          → Records: 2 | TTL: 30d | Last modified: 2026-02-12
projects/    → Records: 3 | TTL: 30d | Last modified: 2026-02-12
discoveries/ → Records: 1 | TTL: 30d | Last modified: 2026-02-12
```

Zones auto-create when you save the first record in a namespace. They give LLMs navigation context without loading any records.

### 4. Resolution Engine

```
resolve("me/background")
  → Lookup record at path
  → Found: SUMMARY → return it (agent reads summary, done)

resolve("me/")
  → Path ends with / → auto-generate COLLECTION
  → Lists all children: [background (SUMMARY), preferences (META)]
  → Agent browses, picks what it needs

resolve("research/nosql")
  → Found: ALIAS → target: "discoveries/pattern/jwt-auth-pattern"
  → Follow chain (max 5 hops)
  → Return the target record
  → Old references never break

resolve("nonexistent/path")
  → NXDOMAIN (instant, not found)
```

### 5. Query DSL

A simplified SQL-like language parsed by Peggy (~50 line grammar):

```sql
-- Find auth-related discoveries
discoveries where tag='auth' order by hit_count desc limit 5

-- Find sessions from a date
sessions since '2026-02-01'

-- Text search within summaries
files where contains='authentication' limit 10

-- Filter by record type
me where type='META'

-- Combine clauses
discoveries where tag='jwt' and type='SUMMARY' order by title limit 3
```

**Parser output (AST):**
```json
{
  "resource": "discoveries",
  "where": [{ "field": "tag", "op": "=", "value": "auth" }],
  "orderBy": { "field": "hit_count", "direction": "desc" },
  "limit": 5
}
```

### 6. Keyword Search (Reverse Lookup)

DNS has PTR records (IP → domain). Blink has keyword index (keyword → record path).

On every save, keywords are extracted from title + tags + summary, stop-words filtered, and indexed. Search finds records by keyword match count, ranked by relevance.

```
search("redis caching")
  → keyword index lookup: "redis" → [path1, path2], "caching" → [path1, path3]
  → path1 matches both → ranked highest
```

### 7. MCP Server (5 tools)

The primary interface for AI tools. JSON-RPC over stdio:

| Tool | Purpose | Example |
|------|---------|---------|
| `blink_resolve` | Resolve path → typed record | `blink_resolve({path: "me/background"})` |
| `blink_save` | Save knowledge | `blink_save({namespace: "me", title: "Background", summary: "..."})` |
| `blink_search` | Keyword reverse lookup | `blink_search({keywords: "redis caching"})` |
| `blink_list` | List namespace contents | `blink_list({namespace: "projects/"})` |
| `blink_query` | Execute DSL query | `blink_query({query: "discoveries where tag='auth'"})` |

### 8. CLI (9 commands)

```bash
blink save --ns <ns> --title <title> --type <type> [content]
blink resolve <path>
blink list <namespace>
blink search <keywords...>
blink query "<query string>"
blink zones
blink delete <path>
blink move <from> <to>
blink serve                  # Start MCP server
```

---

## SQLite Schema

Three tables. Four indexes. Minimal.

```sql
records    → id, path, namespace, title, type, summary, content, ttl,
             created_at, updated_at, content_hash, tags, token_count,
             hit_count, last_hit, sources

zones      → path, description, default_ttl, record_count,
             created_at, last_modified

keywords   → keyword, record_path (composite PK, FK to records.path)
```

**Data lives at:** `~/.blink/blink.db`

---

## Tech Stack

| Component | Technology | Why |
|-----------|-----------|-----|
| Runtime | Bun | Built-in SQLite, fast startup, modern |
| Database | bun:sqlite | Zero deps, synchronous, <5ms queries |
| MCP | @modelcontextprotocol/sdk | Standard protocol for AI tools |
| Query parser | Peggy (PEG) | 50 lines, zero runtime deps, 20KB output |
| CLI | Commander | Standard, lightweight |
| Build | tsup | Fast, ESM output |
| Tests | bun:test | Native, 37ms for 43 tests |

**Total build output:** 51KB single ESM file.

**Dependencies:** 2 runtime (MCP SDK, Commander). 4 dev (Peggy, tsup, TypeScript, @types/bun).

---

## What's NOT in MVP (by design)

| Feature | Why Deferred |
|---------|-------------|
| Bloom filter | SQLite is <5ms for 10K records |
| LRU cache | SQLite page cache is sufficient |
| Stale-while-revalidate | No background refresh needed yet |
| Source processor (fetch+summarize URLs) | Manual content saves for now |
| HTTP API | MCP + CLI sufficient |
| RAG record type | 5 types enough for validation |
| Zone export/import | Git-backup the SQLite file for now |
| Multi-agent namespaces | Single user for validation |

---

## How to Validate

### Step 1: Populate with real context

```bash
blink save --ns me --title "Background" \
  "Arpit, 28, self-taught engineer, 4.5 years. Built ToolJet, building Orpheus."

blink save --ns me --title "Preferences" --type META \
  '{"language":"Go","editor":"Cursor","testing":"table-driven"}'

blink save --ns projects/blink --title "Architecture" --tags "dns,blink" \
  "DNS-inspired knowledge resolution. TypeScript, SQLite, MCP."
```

### Step 2: Connect to Claude Code/Desktop

Add to MCP config:
```json
{
  "mcpServers": {
    "blink": {
      "command": "~/.bun/bin/bun",
      "args": ["/path/to/blink-query/dist/index.js", "serve"]
    }
  }
}
```

### Step 3: Test with an AI tool

Ask Claude:
- "What do you know about me?" → Agent calls `blink_resolve("me/")`
- "What are my coding conventions?" → Agent calls `blink_resolve("me/preferences")`
- "Find my notes about auth" → Agent calls `blink_search({keywords: "auth"})`

### Step 4: Evaluate

Does the agent:
1. Actually use Blink tools naturally?
2. Treat META records as rules vs SUMMARY as context?
3. Navigate namespaces via COLLECTION?
4. Find knowledge via search and queries?

If yes → we have signal. Scale to Phase 2.
If no → the problem wasn't as painful as it looked.

---

## File Map

```
src/
├── types.ts           68 lines   All interfaces and types
├── store.ts          268 lines   SQLite CRUD, zones, keywords
├── resolver.ts        60 lines   Path resolution, ALIAS chain, auto-COLLECTION
├── grammar/
│   ├── query.peggy    50 lines   PEG grammar for query DSL
│   └── query-parser.d.ts         Type declaration for generated parser
├── query-executor.ts  16 lines   Parse query → execute on SQLite
├── mcp.ts            127 lines   MCP server (5 tools)
└── index.ts          167 lines   CLI (9 commands)

tests/
├── store.test.ts                 Store + keyword tests (20 tests)
├── resolver.test.ts              Resolution tests (7 tests)
├── query-parser.test.ts          Parser tests (11 tests)
└── query-executor.test.ts        End-to-end query tests (8 tests)

Total: ~756 lines of source, 43 tests, 37ms test suite
```

---

## The DNS Mapping (What We Actually Used)

| DNS Concept | Blink Equivalent | Status |
|-------------|-----------------|--------|
| Record types (A, MX, CNAME, TXT) | SUMMARY, META, SOURCE, ALIAS, COLLECTION | **Built** |
| Hierarchical names | Namespace tree (me/, projects/orpheus/) | **Built** |
| CNAME (alias) | ALIAS records with chain resolution | **Built** |
| PTR (reverse lookup) | Keyword → path index | **Built** |
| SOA (zone config) | Zone metadata per namespace | **Built** |
| NS (zone listing) | Auto-COLLECTION for namespace paths | **Built** |
| TTL | Per-record TTL field | **Stored, not enforced yet** |
| Multi-tier caching | — | Deferred (SQLite fast enough) |
| DNSSEC (verification) | Content hash (SHA-256) | **Stored, not enforced yet** |
| Stale-while-revalidate | — | Deferred |
| Zone transfer (AXFR) | — | Deferred (export/import) |
