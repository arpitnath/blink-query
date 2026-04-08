# Connecting blink-query to your agent

A walkthrough for plugging blink-query into Claude Desktop, Claude Code, Cursor, and Codex via MCP. For developer use of the library in code, see [`USING_IN_PROJECT.md`](USING_IN_PROJECT.md).

---

## The 30-second path

```bash
npx blink-query init      # auto-detect your agent and write the MCP config
blink doctor              # verify the install
```

`init` detects which agents are installed on your machine, writes the appropriate MCP config file for each one, and merges into any existing config without overwriting other servers. `doctor` verifies the config files exist and the MCP server can start.

If both succeed you're done — open your agent and the `blink_*` tools should be available.

If something fails, read the rest of this doc.

---

## What `blink init` actually does

For each detected agent, `init`:

1. **Locates the config file** at the agent's standard path (see [Per-agent walkthroughs](#per-agent-walkthroughs))
2. **Reads the existing config** if present, parses the JSON or TOML
3. **Adds a `blink` MCP server entry** under `mcpServers` (or equivalent), preserving any other servers you've configured
4. **Picks the right command**: defaults to `npx -y blink-query mcp`. With `--absolute-node` it writes the absolute path to your `node` binary instead — use this if your agent doesn't source your shell rc and can't find `npx`.
5. **Wraps in `cmd /c` on Windows** so the shell can find `npx`
6. **Backs up to `<config>.bak`** if the existing JSON failed to parse, and warns

Nothing more. The MCP server itself runs over stdio — no network listener, no daemon.

---

## Per-agent walkthroughs

### Claude Desktop

**macOS config path**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows config path**: `%APPDATA%\Claude\claude_desktop_config.json`

After `blink init`, the file should contain (merged with anything else you had):

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

Then **fully quit Claude Desktop** (Cmd-Q on macOS, not just close the window) and reopen. MCP servers only load on app launch.

To verify inside the app: open a new conversation and type "list your available tools". You should see entries starting with `blink_` (e.g., `blink_resolve`, `blink_search`).

### Claude Code

```bash
claude mcp add-json blink --scope user '{"type":"stdio","command":"npx","args":["-y","blink-query","mcp"]}'
```

`blink init` runs this for you. The `--scope user` flag means the server is available in every Claude Code session, not just the current project.

To verify: `claude mcp list` should show `blink` in the list. Then start a Claude Code session and ask it to call `blink_search` with any query.

### Cursor

**Config path**: `~/.cursor/mcp.json`

Same shape as Claude Desktop:

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

After `blink init`, **restart Cursor** (full quit, not reload window). MCP tools should appear in the Composer's tool list.

### Codex

**Config path**: `~/.codex/config.toml`

Codex uses TOML, not JSON:

```toml
[mcp_servers.blink]
command = "npx"
args = ["-y", "blink-query", "mcp"]

[mcp_servers.blink.env]
BLINK_DB_PATH = "~/.blink/blink.db"
```

`blink init` writes this for you. After, restart Codex.

---

## Verifying the connection

### `blink doctor`

```bash
blink doctor
```

Outputs a diagnostic for each detected agent:

```
✓ claude-desktop: config at ~/Library/Application Support/Claude/claude_desktop_config.json
  ✓ blink server entry present
  ✓ command resolves: /usr/local/bin/npx
  ✓ MCP server starts (verified via dry-run)

✓ claude-code: blink registered (scope: user)
  ✓ MCP server starts

⚠ cursor: not installed (no ~/.cursor/ found)

✓ codex: config at ~/.codex/config.toml
  ✓ blink server entry present
```

A `✓` for each detected agent means you're ready to go. A `⚠` for an agent you haven't installed is fine. A `✗` is a real failure — read the explanation it prints.

### From inside the agent

The most reliable verification is to actually call a tool. Open your agent and ask:

> *"Use blink_search to search for 'test' in my blink database"*

If the agent calls the tool and returns a result (even an empty one), the connection works. If it says "I don't have access to that tool", the MCP config didn't load — restart the agent.

---

## Adding `BLINK_WIKI.md` to your agent's context

Your agent doesn't automatically know how to use blink-query as a wiki. It needs to read the schema doc.

Two ways to make this happen:

### Option 1: drop the file into your project (Claude Code, Cursor)

```bash
cp $(npm root -g)/blink-query/BLINK_WIKI.md ./BLINK_WIKI.md
```

Or download from the repo. Either way, place `BLINK_WIKI.md` at your project root. Most agents (Claude Code, Cursor) automatically read top-level markdown files in your project context.

### Option 2: paste into the system prompt (Claude Desktop, Codex)

For agents that don't auto-read project files, paste the contents of `BLINK_WIKI.md` into the agent's system prompt or "custom instructions" field. The doc is ~2,000 words — it will fit.

### What `BLINK_WIKI.md` covers

- 30-second mental model of the wiki pattern
- Namespace conventions (`sources/`, `entity/`, `topics/`, `log/<date>/`)
- The 5 record types with examples
- How to ingest, query, log, cross-reference, and lint
- Four worked example sessions

After dropping it in, your agent will know to call `blink_resolve` before falling back to `blink_search`, when to save a `SUMMARY` vs a `SOURCE`, how namespace paths work, and so on.

---

## Setting up your wiki database

Before the agent can resolve anything, the database needs records. Two paths:

### Path A: ingest existing markdown

```bash
blink wiki ingest ./my-notes
```

This walks the directory, parses frontmatter, and creates typed records. Run it whenever your markdown files change.

### Path B: start empty and let the agent populate it

```bash
blink wiki init my-wiki
```

This scaffolds an empty wiki structure and the agent saves records over time as it learns your project.

Either way, the database lives at `~/.blink/blink.db` by default (set `BLINK_DB_PATH` to override).

---

## Troubleshooting

### "agent doesn't list `blink_*` tools"

1. Did you **fully quit and reopen** the agent? MCP servers only load on launch. Cmd-Q on macOS, not just closing the window.
2. Run `blink doctor` — does it show a `✓` for your agent?
3. If `doctor` is fine but the agent doesn't see tools, the config file path may be wrong. Check the per-agent walkthrough above for the canonical path on your OS.
4. Open the agent's developer logs (Claude Desktop: `Help → Developer Tools → Console`) and look for MCP errors.

### "tool call returns empty results"

The MCP server is connected but the database is empty or doesn't contain what you're searching for.

1. Check the database has records: `blink list <namespace>` from the CLI
2. Check `BLINK_DB_PATH` matches between your CLI and the agent's config — they need to point to the same file
3. Try `blink search "..."` from the CLI with the same query the agent used — same result?
4. If CLI works but agent doesn't, the agent and CLI are pointing at different DB files

### "nvm: npx command not found" / "Cannot find npx"

This is the nvm gotcha. nvm-installed Node lives in `~/.nvm/versions/node/<v>/bin`, which is added to your PATH by your shell rc. Agents launched from the GUI (Claude Desktop especially) don't source your shell rc, so they can't find `npx`.

**Fix:**

```bash
blink init --absolute-node
```

This rewrites the config to use the absolute path to your node binary instead of `npx`. Re-run `blink doctor` to verify.

### "Windows: agent can't find npx"

Windows doesn't have a PATH-resolution issue per se, but the command needs to be wrapped in `cmd /c`:

```json
{
  "mcpServers": {
    "blink": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "blink-query", "mcp"]
    }
  }
}
```

`blink init` does this automatically on Windows. If you're hand-editing the config and the agent isn't finding `npx`, check that the wrapper is present.

### "JSON merge clobbered my other MCP server"

`blink init` is supposed to preserve other entries under `mcpServers`. If it didn't, two possibilities:

1. The existing JSON had a parse error and was backed up to `<config>.bak`. Check for the `.bak` file and merge manually.
2. A bug in `init`. Open an issue with the before/after configs.

### "blink doctor reports MCP server failed to start"

Run the server manually:

```bash
npx blink-query mcp
```

This should print something like `blink-query MCP server v2.0.0 listening on stdio`. If it errors:

- **Module not found / install error**: try `npm install -g blink-query` to make sure the package is on disk
- **SQLite error**: the `BLINK_DB_PATH` directory may not exist or may not be writable. `mkdir -p ~/.blink && chmod u+w ~/.blink`
- **Permission denied**: `BLINK_DB_PATH` points somewhere your user can't write

### "tool call works in CLI but not in agent"

Almost always a config-file-path mismatch between the CLI's default DB and the agent's MCP config. The CLI default is `~/.blink/blink.db`. Check the agent's config:

```bash
cat "$HOME/Library/Application Support/Claude/claude_desktop_config.json" | grep BLINK_DB_PATH
```

Make them match by setting `BLINK_DB_PATH` in your shell to whatever the agent uses, or vice versa.

---

## Updating

```bash
npm install -g blink-query@latest
```

The MCP config doesn't need to change — `npx -y blink-query mcp` always uses the latest installed version.

After updating, restart your agent so it re-spawns the MCP server with the new binary.

---

## Uninstalling

```bash
npm uninstall -g blink-query
```

Then remove the `blink` entry from each agent's MCP config manually (or `blink init --uninstall` if you have an older version that still works). Your `~/.blink/blink.db` file is yours to delete or keep.

---

## What the MCP server exposes

Eleven tools:

| Tool | What it does |
|---|---|
| `blink_resolve` | Deterministic O(1) path lookup. Returns `OK` / `NXDOMAIN` / `STALE` / `ALIAS_LOOP`. |
| `blink_search` | Title-weighted BM25 search. Returns top-N ranked typed records. |
| `blink_query` | DSL query for structured filters and sorting. |
| `blink_list` | Browse records in a namespace, sorted by recency / hits / title. |
| `blink_get` | Get a single record by exact path (no resolution). |
| `blink_save` | Create or update a record. |
| `blink_delete` | Delete a record by path. |
| `blink_move` | Move a record from one path to another. |
| `blink_zones` | List all registered zones. |
| `blink_create_zone` | Create or update a zone with metadata (description, default TTL, required tags). |
| `blink_ingest` | Ingest a directory of markdown files. |

Tool schemas are defined in `src/mcp.ts`. The agent reads them at startup; you don't need to do anything.

---

## Where to go next

- [`USING_IN_PROJECT.md`](USING_IN_PROJECT.md) — using blink-query as a library in your own code
- [`../BLINK_WIKI.md`](../BLINK_WIKI.md) — schema doc to feed to your agent
- [`../examples/llm-wiki/`](../examples/llm-wiki/) — a runnable end-to-end example
- [`../benchmark/README.md`](../benchmark/README.md) — universal benchmark methodology and numbers
