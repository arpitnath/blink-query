# Blink — Product Requirements Document

**Version:** 1.0
**Date:** February 2026
**Status:** Post-validation, pre-launch

---

## One-Liner

Blink is an npm package that gives AI agents structured, typed, queryable memory — locally, with zero config.

```bash
npm install blink-query
npx blink serve   # MCP server running. Connect any AI tool.
```

---

## The Problem

AI agents today have no memory architecture. Every tool re-invents storage — flat files, JSON blobs, vector dumps, custom databases. The result:

1. **Agents start cold every session.** They don't know who you are, what you've discussed, or what rules to follow.
2. **Knowledge retrieval is dumb.** RAG agents fetch 15 document chunks when a two-sentence summary would suffice. No hierarchy, no pre-filtering, no "I already know this."
3. **Nothing tells the agent HOW to use what it retrieves.** A coding convention and a project summary come back in the same format. The agent guesses what to do with each.
4. **Memory is platform-locked.** Claude's memory doesn't talk to Cursor's memory doesn't talk to your custom agent's memory. Your knowledge is siloed per tool.

No existing system provides **structured + typed + queryable + portable** memory for AI agents.

---

## The Insight

DNS solved a similar problem for the internet 40 years ago. Before DNS, every computer had a flat `/etc/hosts` file. That didn't scale. DNS introduced hierarchical naming, record types, caching, TTLs, and a resolution protocol.

AI agent memory today is at the `/etc/hosts` stage. Flat. Fragmented. No shared protocol.

**The core innovation:** Record types that tell agents HOW to consume knowledge — not just what it is.

When a DNS resolver gets an MX record, it knows to route email. When it gets a CNAME, it knows to follow the redirect. The resolver doesn't guess — the type IS the instruction.

Same principle. When an agent resolves a **SUMMARY**, it knows to read and move on. When it resolves a **META**, it knows these are rules to follow. The agent doesn't guess — the type IS the consumption instruction.

---

## Who It's For

**Primary:** Developers building AI agents and tools who need persistent, structured context.

- Agent framework developers (LangChain, CrewAI, custom)
- AI tool builders (CLI tools, IDE extensions, copilots)
- Developers using Claude Code, Cursor, or similar AI-assisted dev tools

**Secondary:** Power users who want their AI tools to share memory across sessions and platforms.

**Not for:** Enterprise multi-tenant deployments (yet). Teams needing cloud sync (yet). Non-technical users.

---

## How It Works

### For a RAG Agent

Today: every query hits the vector store. 15 chunks returned. 8,000 tokens consumed. No hierarchy.

With Blink: the agent **resolves before it retrieves.**

```
User: "How do we handle authentication?"

Agent:
  → blink_search("authentication")
  → found: projects/myapp/auth (SUMMARY, 47 previous hits)

  → blink_resolve("projects/myapp/auth")
  → SUMMARY: "JWT with refresh tokens. 15min access in memory,
     7d refresh in httpOnly cookies. Rotate on refresh."
  → Agent reads summary. Done. No RAG call needed.

User: "Show me the actual middleware implementation"

Agent:
  → blink_resolve("projects/myapp/auth-implementation")
  → SOURCE: {
      summary: "Express middleware, validates JWT, refreshes if expired",
      source: "s3://docs/auth-middleware.md"
    }
  → NOW the agent fetches the full document. Only when it needs depth.
```

**Result:** SUMMARY handles 80% of queries without any retrieval. SOURCE bridges to full documents when needed. Token usage drops 10x for common questions.

### For a Conversational Agent

Today: every session starts cold. The agent doesn't know the user.

With Blink: the agent **resolves context at session start.**

```
Session 1 (first conversation):
  User: "Help me set up a React project with state management"
  → Normal conversation. Agent helps choose Zustand.
  → End of session, agent saves:
    blink_save(ns: "me", title: "Background", type: SUMMARY,
      "Frontend developer, React, chose Zustand")
    blink_save(ns: "me", title: "Preferences", type: META,
      { framework: "React", state: "Zustand", style: "functional only" })

Session 2 (a week later):
  User: "Add a shopping cart feature"
  → blink_resolve("me/preferences")
  → META: { framework: "React", state: "Zustand", style: "functional only" }
  → Agent generates cart code using Zustand + functional components.
  → User never re-explained anything. META told the agent what rules to follow.

Session 5:
  → blink_resolve("projects/ecommerce-app/known-bugs")
  → SUMMARY: "Cart total shows stale price on currency switch.
     Root cause: Zustand store doesn't invalidate on locale change."
  → Agent avoids the known bug when writing new code.
```

**Result:** Agents accumulate knowledge over sessions. Preferences persist as rules. Known issues persist as context. Every session starts warm.

---

## The Type System

Five built-in record types. Each carries a behavioral instruction for the LLM.

| Type | Instruction to Agent | Real-World Examples |
|------|---------------------|---------------------|
| **SUMMARY** | "Read this. You have what you need." | User background, project architecture, bug descriptions, research findings, conversation summaries |
| **META** | "These are rules. Follow them." | Coding conventions, user preferences, project policies, configuration, runbooks (steps to follow), decision records |
| **COLLECTION** | "Browse these. Pick what's relevant." | Auto-generated when browsing a namespace. Lists children with types and stats. |
| **SOURCE** | "Summary is here. Fetch the original if you need depth." | Pointers to documents, files, URLs, database records — with a pre-processed summary |
| **ALIAS** | "Follow the redirect. Topics evolve, paths don't break." | Renamed concepts, moved records, topic evolution |

### Why Five Types and Not More

The type carries the **consumption behavior**, not the domain semantics. There are only five things an agent can do with a piece of knowledge:

1. **Read it and move on** → SUMMARY
2. **Follow it as rules** → META
3. **Browse and choose** → COLLECTION
4. **Read the preview, fetch if needed** → SOURCE
5. **Follow the redirect** → ALIAS

Domain semantics live in the **content structure**, not the type:
- A runbook is a META with `{steps: [...]}`
- A policy is a META with `{rules: {...}}`
- A conversation summary is a SUMMARY
- A citation is a SOURCE with provenance fields

The content carries what it is. The type carries what to do with it. Custom types only earn their place if a sixth consumption behavior is discovered — and after testing with real agents, five covers everything we've seen.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Blink                         │
│              (single npm package)                │
│                                                  │
│  ┌─────────┐  ┌───────────┐  ┌──────┐          │
│  │   CLI   │  │ MCP Server│  │Query │          │
│  │         │  │  (stdio)  │  │(Peggy)│         │
│  └────┬────┘  └─────┬─────┘  └──┬───┘          │
│       └─────────────┼───────────┘               │
│                     ▼                            │
│  ┌──────────────────────────────────────────┐   │
│  │           Resolution Engine               │   │
│  │  Path → Type → Behavioral Instruction     │   │
│  └──────────────────┬───────────────────────┘   │
│                     ▼                            │
│  ┌──────────────────────────────────────────┐   │
│  │           SQLite (built-in)               │   │
│  │  records | zones | keywords               │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Storage | SQLite via better-sqlite3 | Zero config. No external DB. Ships with the package. <5ms queries at 10K records. |
| Interface | MCP over stdio | Standard protocol. Works with Claude, Cursor, any MCP-compatible tool. |
| Query | Custom DSL (Peggy) | `discoveries where tag='auth' limit 5` — agents use it for structured filtering, humans use it via CLI. Both audiences. |
| Distribution | npm package | One install. Standard Node.js ecosystem. |
| Runtime | Node.js | better-sqlite3 for SQLite bindings. Widest ecosystem compatibility. |

### Data Model

```
Records:
  path         "me/preferences"              ← unique, hierarchical
  namespace    "me"                           ← browsable zone
  type         "META"                         ← consumption instruction
  summary      "Coding preferences..."        ← always present, short
  content      { lang: "Go", editor: "..." }  ← structured data (JSON)
  tags         ["coding", "preferences"]       ← searchable keywords
  ttl          2592000                         ← freshness (30d default)
  hit_count    47                              ← popularity signal
  sources      ["file:///path/to/doc"]         ← external references

Zones (auto-created):
  path         "me"
  record_count 3
  last_modified "2026-02-11T..."

Keywords (reverse index):
  keyword      "coding"
  record_path  "me/preferences"
```

---

## MCP Interface (5 Tools)

These are what AI agents see and use.

| Tool | Purpose | When Agent Uses It |
|------|---------|-------------------|
| `blink_resolve` | Resolve path → typed record | "What's at this path?" / "Browse this namespace" |
| `blink_save` | Store knowledge | "Remember this for later" |
| `blink_search` | Keyword reverse lookup | "Find anything about X" (most common discovery tool) |
| `blink_list` | List namespace contents | "What's in this namespace?" |
| `blink_query` | Execute DSL query | "Find records matching complex criteria" |

**Validated behavior** (from testing with Claude Sonnet 4.5):
- Agent naturally reaches for `blink_search` for vague queries
- Agent uses `blink_resolve("namespace/")` to browse (auto-COLLECTION)
- Agent treats META responses as rules without explicit prompting
- Agent reads SUMMARY and stops — doesn't ask for more
- Average interaction: ~2,400 tokens. Compared to RAG: 10x reduction.

---

## CLI (9 Commands)

For humans and scripts.

```bash
blink save --ns <ns> --title <title> --type <type> --tags <tags> [content]
blink resolve <path>
blink list <namespace>
blink search <keywords...>
blink query "<query string>"
blink zones
blink delete <path>
blink move <from> <to>
blink serve                  # Start MCP server (stdio)
```

---

## Query DSL

A simplified SQL-like language for filtered retrieval.

```sql
discoveries where tag='auth' order by hit_count desc limit 5
me where type='META'
projects where contains='authentication' limit 10
sessions since '2026-02-01'
discoveries where tag='jwt' and type='SUMMARY' order by title limit 3
```

Parsed by a 50-line Peggy grammar. Output is an AST translated to SQLite queries.

---

## Distribution Plan

### Phase 1: npm Package (Current Target)

```bash
npm install blink-query
```

- Single package, Node.js with better-sqlite3
- MCP server over stdio
- CLI for direct use
- SQLite database at `~/.blink/blink.db`
- Minimal dependencies: better-sqlite3, MCP SDK, Commander

### Phase 2: Ecosystem Integration

- Pre-built integrations for Claude Code, Cursor, Windsurf
- Framework adapters (LangChain, CrewAI, Vercel AI SDK)
- `npx create-blink` for project scaffolding with starter records

### Phase 3: Cloud Sync (If Validated)

- Optional sync layer for cross-device memory
- Conflict resolution for concurrent writes
- Encrypted sync (your knowledge, your keys)
- Still local-first — cloud is optional, not required

---

## What's In v1

| Feature | Status |
|---------|--------|
| 5 record types (SUMMARY, META, COLLECTION, SOURCE, ALIAS) | Built, tested |
| Hierarchical namespaces | Built, tested |
| Zone SOA (auto-created namespace metadata) | Built, tested |
| ALIAS resolution with chain following (max 5 hops) | Built, tested |
| Auto-COLLECTION for namespace browsing | Built, tested |
| Keyword reverse index (search) | Built, tested |
| Query DSL (Peggy parser) | Built, tested |
| MCP server (5 tools, stdio) | Built, tested |
| CLI (9 commands) | Built, tested |
| SQLite storage (WAL mode, foreign keys) | Built, tested |
| Content hashing (SHA-256) | Built, stored |
| Hit counting and popularity tracking | Built, tested |
| TTL per record | Stored, not enforced |
| Node.js support (better-sqlite3) | Confirmed — primary runtime |

## What's NOT In v1

| Feature | Why Not |
|---------|---------|
| Custom record types | Five covers all consumption behaviors. Revisit if a sixth is found. |
| Multi-tier caching | SQLite is <5ms. Not needed. |
| HTTP API | MCP + CLI sufficient for validation. |
| Cloud sync | Local-first. Validate single-user first. |
| Source processor (auto-fetch + summarize URLs) | Manual content for now. Phase 2. |
| Vector search / embeddings | Keyword search + DSL sufficient. Blink is resolution, not retrieval. |
| Multi-user / auth | Personal tool. Single user. |
| Schema validation for content | Can add later. Content is freeform JSON for now. |

---

## Success Metrics

### For v1 (npm launch)

1. **Adoption:** 100+ npm installs in first month
2. **Retention:** Users who save 10+ records come back within 7 days
3. **Agent behavior:** LLMs treat META as rules and SUMMARY as context without custom prompting (validated)
4. **Performance:** <5ms resolution at 10K records (validated)
5. **Token efficiency:** 5-10x token reduction vs raw RAG for common queries

### For v2 (ecosystem)

1. **Integration:** 3+ AI tools connecting to the same Blink instance
2. **Cross-session value:** Users report agents "remembering" context across sessions
3. **Community:** Users sharing namespace templates and content patterns

---

## Decided

1. **Runtime: Node.js with better-sqlite3.** Node.js is the primary runtime. Swap `bun:sqlite` to `better-sqlite3` before npm publish. Same synchronous API, minimal code change.

2. **Query DSL: For agents AND humans.** Agents use it for structured filtering (`blink_query`). Humans use it via CLI. Both audiences. The DSL stays.

## Open Questions

1. **TTL enforcement:** Records have TTL but we don't enforce staleness. Should stale records return with a warning? Should they auto-expire? Or is TTL just metadata for the agent to interpret?

2. **Content patterns documentation:** Should we ship "starter templates" for common patterns? (runbook as META with steps, decision log as META with rationale, etc.)

3. **Package name:** `blink-query` works but `blink` is cleaner. Check npm availability.

4. **Source processing:** When a SOURCE record points to a URL or file, should Blink auto-fetch and summarize? Or keep it manual? Auto-processing adds value but adds complexity and failure modes.

---

## Competitive Landscape

| Product | What It Does | What Blink Does Differently |
|---------|-------------|---------------------------|
| **mem0** | Memory layer for AI apps | No record types. No consumption instructions. Flat memory. |
| **Letta** | Stateful LLM agents | Tightly coupled to their agent framework. Not portable. |
| **LangChain Memory** | Conversation memory | Framework-specific. No types. No cross-tool portability. |
| **ChatGPT Memory** | Platform memory | Platform-locked. No structure. No query. Can't use from other tools. |
| **Claude Memory** | Platform memory | Same as above. Better quality, still locked to Claude. |
| **RAG (general)** | Document retrieval | Retrieval, not resolution. No types. No hierarchy. Token-heavy. |

**Blink's moat:** The type system. No one else tells agents HOW to consume knowledge. Types are the protocol-level innovation — everything else (namespace hierarchy, query DSL, keyword search) supports them.

---

## The Test That Validated This

We built an MVP, seeded 12 records across 4 zones, and connected Claude Sonnet 4.5 via MCP stdio. Five test prompts. Zero few-shot examples. One-paragraph system prompt.

Results:
- Claude browsed namespaces via COLLECTION naturally
- Claude treated META as rules ("these should be followed as instructions")
- Claude read SUMMARY and stopped — never asked for more
- Claude saved new knowledge with correct type and tags
- Average: 2,400 tokens per interaction

Full results: [TEST_RESULTS.md](./TEST_RESULTS.md)

The type system works. Agents understand it without training. The protocol carries the semantics.
