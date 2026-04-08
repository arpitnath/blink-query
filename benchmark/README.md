# blink-query benchmark

A reproducible benchmark comparing **blink-query** against **grep** and **ripgrep** on three public markdown corpora of different shapes and sizes.

> **One command. Three corpora. Universal library defaults. Anyone can run it.**

```bash
git clone https://github.com/arpitnath/blink-query
cd blink-query
npm install
npm run benchmark
```

That's it. The benchmark auto-clones three public markdown corpora, runs blink-query + grep + ripgrep against them with the same query set, and prints a cross-corpus comparison.

---

## What it measures

For each corpus, for each query, three baselines are run on the **identical file set**:

| Baseline | What it represents |
|---|---|
| **`grep`** | The literal naive approach: `xargs -0 grep -l -F -i "<term>"` over all files |
| **`ripgrep`** | The modern fast naive approach: `xargs -0 rg -l -F -i "<term>"` |
| **`blink-query`** | Title-weighted BM25 over typed records; returns ranked top-5 |

Per-query metrics:

- **Latency** (mean / p50 / p95 / max) — wall-clock time per query
- **Found-oracle** (grep, ripgrep) — whether the canonical answer file appears anywhere in the unranked result list
- **P@1** (blink) — whether the canonical answer is at position 1 of the top-5
- **P@3** (blink) — whether the canonical answer is in positions 1–3
- **Avg result count** — files agent has to read

Each query has a verifiable **oracle**: a regex matching the canonical answer file in the corpus. Oracles are defined inline in `benchmark/bench.ts`.

---

## Corpora

Three public markdown corpora, chosen for structural diversity:

| Corpus | Shape | Files | Cloned from |
|---|---|---|---|
| **Quartz docs** | Digital garden — flat descriptive filenames + index.md in subdirs | ~76 | https://github.com/jackyzha0/quartz (`docs/`) |
| **Obsidian Help vault** | Curated wiki — `Introduction to X.md` style, frontmatter, wikilinks | ~171 | https://github.com/obsidianmd/obsidian-help (`en/`) |
| **MDN content** | Large reference docs — every page is `<topic>/index.md` | ~14,251 | https://github.com/mdn/content (`files/en-us/`) |

Each corpus is **cloned shallow at run time** (`--depth 1`). They are not redistributed, just measured. The first run downloads ~270 MB total. Subsequent runs reuse the local clones (delete `benchmark/corpora/` to refresh).

---

## How it stays universal

Blink-query's library defaults handle corpus-shape variation automatically. There is **one ingest configuration** in `benchmark/bench.ts`. No `--mode` flag, no per-corpus presets, no smart-vs-naive switch.

What the library does:

1. **Title-weighted BM25** in `searchByKeywords` — `bm25(records_fts, 10.0, 4.0, 1.0)` boosts title matches 10× over body summary matches. Universal across docs sites, wikis, and flat notes.
2. **`defaultClassify`** in `processDocuments` — reads the `is_hub` metadata flag (set during `loadDirectoryBasic`) and promotes canonical hub pages (an `index.md` / `README.md` whose parent dir contains other subdirectories) to `SUMMARY` records, which receive a `-2.0` rank offset.
3. **`filesystemTitle`** parent-dir fallback — for `index.md` / `README.md` / `Home.md` / `About.md` files, use the parent directory name as the title (so MDN's `<topic>/index.md` files don't all get title="index").
4. **H1 fallback in `filesystemTitle`** — for date-style or UUID-style filenames (Logseq, Notion exports), fall back to the first H1 in the document body.
5. **Hub-vs-leaf detection in `loadDirectoryBasic`** — pre-walk pass that tags each directory as hub (has subdirs) or leaf (file-only). Cheap, additive metadata.

The bench script reproduces the hub-detection in its own walker (because it hand-builds `IngestDocument`s rather than calling `loadDirectoryBasic`), but the *classification* and *ranking* logic both live in the library.

---

## File structure

```
benchmark/
  README.md         # this file
  bench.ts          # single-corpus runner — reads queries, ingests, scores
  setup.ts          # auto-clones the 3 public corpora into corpora/
  run-all.ts        # orchestrator: runs setup + bench × 3 + cross-corpus summary
  results.json      # unified machine-readable results (gitignored)
  corpora/          # cloned upstream repos (gitignored)
    quartz/
    obsidian-help/
    mdn-content/
  .tmp/             # per-corpus runtime artifacts (gitignored)
    quartz/
      blink.db
      files.txt
      report.json
    obsidian/...
    mdn/...
```

---

## Commands

| Command | What it does |
|---|---|
| `npm run benchmark` | The headline command. Setup + run all 3 corpora + cross-corpus summary. ~30–60 sec on a fast machine after first setup. |
| `npm run benchmark:setup` | Just clone the corpora (idempotent — skips already-present). |
| `npm run benchmark:setup -- --force` | Delete and re-clone everything. |
| `npm run benchmark:single -- <root> <key>` | Run the bench on a single corpus. Useful for tuning. |

---

## Reading the output

The `npm run benchmark` output has four parts:

1. **Setup** — what got cloned, what was already present, with commit SHAs
2. **Per-corpus runs** — for each corpus: walk + ingest stats, per-query line (`grep <ms> | ripgrep <ms> | blink <ms> P@1 ✓/✗ P@3 ✓/✗`), then a per-corpus summary card with latency, accuracy, and speedup
3. **Cross-corpus summary** — three tables side-by-side:
   - Latency (mean per query) for grep / ripgrep / blink across all 3 corpora
   - **ASCII speedup bars** showing blink-vs-grep speedup per corpus
   - Accuracy (grep found vs blink P@1 / P@3) per corpus
   - Files-agent-must-read comparison (grep dumps N files unranked, blink returns top-5 ranked)
4. **Headline** — one bold line with the speedup range and average accuracy

Machine-readable output is written to `benchmark/results.json` after every run.

---

## Reference numbers (Apple M4 Pro, Node v22)

These are the numbers I see on a 2024 MacBook with M4 Pro / 24 GB / Darwin 25 / Node v22.22 / ripgrep 15.0.0. **Your numbers will vary by hardware**, but the *relative* numbers (blink vs grep, blink vs ripgrep) should hold across machines.

| Corpus | Files | grep mean | ripgrep mean | **blink mean** | vs grep | vs rg | **P@1** | **P@3** |
|---|---|---|---|---|---|---|---|---|
| Quartz docs | 76 | 8.9 ms | 11.1 ms | **0.36 ms** | 25× | 31× | **79%** | **79%** |
| Obsidian Help | 171 | 15.9 ms | 11.9 ms | **0.56 ms** | 28× | 21× | **69%** | **88%** |
| MDN content | 14,251 | 891 ms | 249 ms | **9.83 ms** | **91×** | **25×** | **44%** | **72%** |

**Average across the 3 corpora: P@1 = 64%, P@3 = 79%. blink is 25×–91× faster than grep.**

Note: as corpus size grows, blink's speedup over grep grows. blink scales sub-linearly; grep scales linearly. On the 14k-file MDN corpus, grep returns an average of **1,212 files unranked per query** (because common terms like "Promise" appear in 1,314 files, "DOM" in 9,363 files, etc.). blink returns 5 ranked.

---

## Known limits (honest)

These are documented because credibility matters more than headline numbers:

1. **MDN entity queries are hard.** "What is the DOM" → "DOM" appears in 9,363 MDN files. Pure BM25 over title+tags+summary can't always pick the canonical glossary entry over high-density sub-pages. blink's **44% P@1** on MDN is real and reflects a known BM25 limit on dense reference corpora at scale. blink finds the right file in **top-3** for 72% of MDN queries (P@3), so the agent reads 3 files instead of 1,212.

2. **Single-run, single-machine numbers.** No multi-run statistics, no stddev, no inter-machine variance. Latencies under ~2ms have ±1ms noise from OS scheduling. For statistical rigor, run multiple times and compare yourself.

3. **Hand-authored queries (16/18/14 per corpus).** Each query has a regex oracle. All queries and oracles are visible in `benchmark/bench.ts` (not hidden in a JSON file). PRs adding more queries are welcome.

4. **Process startup dominates grep/ripgrep latency on small corpora.** Each grep/ripgrep invocation pays ~10 ms of process spawn cost via `xargs`. blink runs in-process. A long-running grep daemon would close some of the gap; from a CLI it's representative of real usage.

5. **Smart-mode tuning was deliberately removed.** Earlier iterations of this bench had per-corpus "smart" classifiers that boosted Obsidian to 81% P@1. They hurt MDN. We removed all per-corpus tuning to make the bench truly universal — the cost is ~12 percentage points P@1 on Obsidian, the gain is "anyone can clone any corpus and get reasonable numbers without tuning."

---

## Adding your own corpus

To benchmark blink-query on your own markdown corpus:

```bash
# Run the single-corpus bench directly (no auto-clone)
npm run benchmark:single -- /path/to/your/markdown/dir <corpus-key>
```

The `<corpus-key>` must match a query set in `benchmark/bench.ts`. To add a new corpus:

1. Decide a corpus key (e.g., `mywiki`)
2. Add it to the `appliesTo` union type at the top of `benchmark/bench.ts`
3. Add 10–20 query objects with verified oracle paths to the `QUERIES` array
4. Run: `npm run benchmark:single -- /path/to/corpus mywiki`
5. (Optional) Add the corpus to `benchmark/setup.ts` `CORPORA` array so it joins the `npm run benchmark` rotation

PRs welcome.

---

## What this benchmark does NOT measure

- **Vector / embedding retrieval** (Vectra, FAISS, Pinecone) — different category, different cost model. blink-query is intentionally lexical-only at this layer.
- **LLM-as-judge accuracy scoring** — we use mechanical regex oracles to avoid LLM bias and cost. Strangers can read every oracle.
- **Long-running daemon vs CLI startup** — both grep/ripgrep and blink are measured as one-shot CLI invocations (blink is in-process, the others spawn). A blink MCP server keeps the index warm and doesn't pay per-query startup at all.
- **Multi-run statistical tests** — single run per query. v2.1 may add `--runs N` for stddev.
- **Indexing cost is one-time but real** — blink takes ~16 sec to ingest 14k MDN files. Worth it if you query more than ~30 times. grep takes 0 to "set up" but pays full cost per query.

---

## License

Bench script: MIT (same as blink-query).
Public corpora cloned by setup.ts: each retains its own upstream license. We do not redistribute them.
