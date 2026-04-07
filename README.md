# blink-query

**A typed wiki for LLMs — markdown on disk, resolution in the library.**

The LLM wiki pattern ([see the original gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f)) is a clean idea: keep a folder of markdown files, let the agent read and grep them, build up institutional memory over time. I ran it for a while and kept wanting a few things: a way to say what each file *is* (summary, log entry, source reference), a deterministic lookup path that didn't require guessing filenames, and a query interface the agent could use without spawning a shell. So I built them as a library on top of the same markdown files.

blink-query is that library. Markdown on disk, typed records in SQLite, path resolution at query time, FTS5 search, a query DSL, and an MCP server so your agent can call it directly. If you want to grep the files yourself, grep them — nothing's hidden. The library is a faster, typed path on top.

---

## Quick start

```bash
npm install -g blink-query
blink init
blink wiki init my-wiki
```

`blink init` auto-detects your agent environment (Claude Desktop, Claude Code, Cursor, Codex) and writes the MCP config file. `blink wiki init my-wiki` creates the folder structure and ingests any existing markdown.

---

## Benchmark

The production-scale numbers below come from the v1.1.0 pathfinder benchmark: 3,890 real GitHub issues from Next.js, React, Vite, and Svelte, evaluated head-to-head against a vectra-based RAG pipeline over the same corpus on a local Ollama setup. Reproducible with `cd examples/pathfinder && npm run ingest && npm run benchmark`.

| | blink-query (BM25) | RAG (vectra) |
|---|---|---|
| Retrieval latency (avg) | **~4 ms** | ~59 ms |
| Repeat-query cache hit | **100%** (learned) | 0% (stateless) |
| Records indexed | 3,890 typed | 3,890 chunked |
| External dependencies | none (SQLite + FTS5) | Ollama + `nomic-embed-text` |

**~15× faster retrieval, and the blink side *learns* across queries** — records re-resolve in O(1) after the first hit. Full tables, per-question breakdown, and the learning-cache pass are in [`examples/pathfinder/src/benchmark.ts`](examples/pathfinder/src/benchmark.ts).

A smaller wiki-specific retrieval comparison (recursive grep vs blink BM25 on 30 curated markdown files) ships in [`examples/llm-wiki/benchmark/`](examples/llm-wiki/benchmark/). Both baselines run locally with only Node installed — see [`examples/llm-wiki/benchmark/RESULTS.md`](examples/llm-wiki/benchmark/RESULTS.md).

---

## What this is (and isn't)

blink-query is a library, not a framework or a replacement. It's additive on top of plain markdown files:

- **Your files stay where they are.** Markdown in `sources/`, `entity/`, `topics/`, `log/<date>/`. You can grep them, open them in any editor, commit them to git, nothing about them is opaque.
- **The library adds an index, types, and a query interface.** Think of blink-query as a deterministic faster path on top of the same files — not a replacement for them.
- **No embeddings.** BM25 / FTS5 only. If you want semantic retrieval, you can run blink-query alongside a vector store and pick whichever answer is better for the query.
- **No cloud.** SQLite file on disk, MCP server over stdio, runs entirely on your machine.
- **No magic.** Ingestion is rule-based derivers you can override. Classification is based on frontmatter you control. The query DSL is a Peggy grammar you can read.

If you want raw markdown + grep, the files still work that way. If you want typed records with an index, install the library.

---

## Install in your agent

The easy path — let blink detect your agent environment and write the config:

```bash
npx blink-query init
```

This auto-detects Claude Desktop, Claude Code, Cursor, and Codex, handles the nvm + absolute-node-path gotcha on macOS/Linux, wraps `npx` in `cmd /c` on Windows, and merges into your existing MCP config (it never overwrites other servers — if the JSON fails to parse, it backs up to `.bak` and warns).

Run `blink doctor` afterwards to verify each installation and MCP server connectivity.

### Manual config snippets

If you'd rather paste the config yourself:

**Claude Desktop** — `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "blink": {
      "command": "npx",
      "args": ["-y", "blink-query", "mcp"],
      "env": { "BLINK_DB_PATH": "~/.blink/blink.db" }
    }
  }
}
```

**Claude Code** — run once:

```bash
claude mcp add-json blink --scope user '{"type":"stdio","command":"npx","args":["-y","blink-query","mcp"]}'
```

**Cursor** — `~/.cursor/mcp.json` (same shape as Claude Desktop, key `mcpServers`).

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.blink]
command = "npx"
args = ["-y", "blink-query", "mcp"]

[mcp_servers.blink.env]
BLINK_DB_PATH = "~/.blink/blink.db"
```

**nvm users:** if Claude Desktop can't find `npx`, use `blink init --absolute-node` which writes the absolute path to your node binary instead of `npx`. This avoids the "doesn't source shell rc" issue.

The MCP server exposes 10 tools: `blink_resolve`, `blink_save`, `blink_search`, `blink_list`, `blink_query`, `blink_get`, `blink_delete`, `blink_move`, `blink_zones`, `blink_ingest`.

Drop [`BLINK_WIKI.md`](BLINK_WIKI.md) into your project root (or add it to your agent's system prompt) so the agent knows how to use the wiki pattern.

---

## What you get

Five record types. The type is a consumption instruction — it tells the agent *how to use* the record, not what it's about. Content carries the domain semantics.

**SUMMARY** — read the summary directly, you have what you need.
Use for processed wiki pages, entity descriptions, topic overviews. The agent doesn't need to fetch anything else.

**META** — structured data (JSON content field).
Use for configuration, log entries, session state, entity attributes. The agent parses `content` as JSON.

**SOURCE** — summary here, fetch the source if you need depth.
Use for references to external documents: papers, URLs, git files, API specs. Summary gives enough to decide whether to fetch.

**ALIAS** — follow the redirect to the target record.
Use for cross-linking. `[[wikilinks]]` in your markdown auto-extract to ALIAS records on ingest.

**COLLECTION** — browse children, pick what's relevant.
Use for namespace indexes. Auto-generated when you resolve a namespace path that has no direct record.

---

## Example wiki

[`examples/llm-wiki/`](examples/llm-wiki/) is a complete end-to-end example: a 30–50 file MCP ecosystem corpus ingested, queried, and benchmarked against markdown+grep and RAG baselines.

---

## Schema doc

[`BLINK_WIKI.md`](BLINK_WIKI.md) is the document your LLM agent reads to understand how to use blink-query as a wiki. It covers namespace conventions, all five record types with examples, ingest/query/log/lint workflows, and four worked example sessions. Drop it in your project root.

---

## Library API

```typescript
import { Blink, extractiveSummarize } from 'blink-query';

const blink = new Blink({ dbPath: './wiki.db' });

// Ingest a directory of markdown files
await blink.ingestDirectory('./my-wiki', {
  summarize: extractiveSummarize(500),
  namespacePrefix: 'wiki'
});

// Resolve a path — deterministic O(1) lookup
const response = blink.resolve('wiki/mcp-protocol');
if (response.status === 'OK') {
  console.log(response.record.summary);
}

// Search — BM25/FTS5
const results = blink.search('tool call protocol');

// Query DSL
const summaries = blink.query('wiki where type = "SUMMARY" order by hit_count desc limit 10');

blink.close();
```

All CRUD operations are synchronous (`resolve`, `get`, `save`, `delete`, `move`, `search`, `list`, `query`). Only ingestion is async.

---

## CLI

```bash
# Wiki workflows
blink wiki init my-wiki          # scaffold + ingest
blink wiki ingest ./my-wiki      # re-ingest after changes
blink wiki lint                  # find STALE, NXDOMAIN, orphans

# Core operations
blink resolve wiki/mcp-protocol  # resolve a path
blink search "tool call protocol"
blink query 'wiki where type = "SUMMARY" limit 10'
blink list wiki --limit 20

# Agent setup
blink init                       # write MCP config for detected agent
blink doctor                     # post-install diagnostic

# Data management
blink ingest ./docs --prefix wiki
blink move wiki/old wiki/new
blink delete wiki/outdated
blink zones
```

All commands support `--json` for machine-readable output and `--db` for a custom database path.

---

## Scope

blink-query handles:
- Markdown and plain text (primary)
- PDF (coming in v2.1)
- PostgreSQL tables (via `loadFromPostgres`)
- Web URLs (via `loadFromURL`)
- Git repositories (via `loadFromGit`)
- GitHub Issues (via `loadFromGitHubIssues`)

---

## What we don't do

- **Vector embeddings.** blink-query uses BM25/FTS5, not dense retrieval. If you need semantic similarity search, layer a RAG system on top. The benchmark in `examples/llm-wiki/` shows where each approach wins.
- **Sync or replication.** Single SQLite file, local. If you need multi-machine access, sync the markdown source with git and re-ingest.
- **Hosted storage.** No cloud, no accounts. Your data lives in a `.db` file you own.
- **Agent orchestration.** blink-query resolves knowledge. It doesn't plan tasks or coordinate agents.
- **Magic.** It's SQLite with a query layer on top of your markdown files. You can open the database directly with any SQLite client if something seems wrong.

---

## Development

```bash
npm install
npm run build       # builds parser + library + CLI
npm test            # 388+ tests
npm run test:all    # includes PostgreSQL integration tests
```

---

## Status

**v2.0.0** — active development. Published on npm as `blink-query`. MIT license.

```bash
npm install blink-query        # library
npm install -g blink-query     # CLI + blink init
```

Issues and PRs welcome. The library is small enough that a single person can hold the whole thing in their head — the goal is to keep it that way.
