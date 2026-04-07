---
title: "MCP Server — Filesystem (Official)"
source_url: https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem
date: 2024-11-25
type: SOURCE
---

# MCP Server — Filesystem

The official filesystem MCP server. One of the most commonly used servers — gives the AI
read/write access to specified directories on the local machine.

## Installation

```bash
# Run directly (specify allowed directories)
npx -y @modelcontextprotocol/server-filesystem /Users/me/documents /Users/me/projects

# Claude Desktop config
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/Users/me/documents",
        "/Users/me/projects"
      ]
    }
  }
}
```

The directories passed as arguments are the **only** directories the server can access.
This is the primary security boundary.

## Tools exposed

| Tool | Description |
|------|-------------|
| `read_file` | Read complete file contents |
| `read_multiple_files` | Read several files at once |
| `write_file` | Create or overwrite a file |
| `edit_file` | Make targeted edits (patch-style) |
| `create_directory` | Create a directory |
| `list_directory` | List directory contents |
| `directory_tree` | Recursive tree view |
| `move_file` | Move or rename |
| `search_files` | Pattern-match file names |
| `get_file_info` | Metadata (size, permissions, dates) |
| `list_allowed_directories` | Show configured roots |

## Security model

- Access is restricted to the directories specified at launch — no path traversal
- The server does NOT validate whether paths exist before attempting access (relies on OS)
- Symlinks inside allowed directories may resolve outside (OS-level)
- No user confirmation for destructive operations (write, delete) — the AI can overwrite files

**Recommendation**: Mount only directories you're comfortable with the AI reading and
modifying. Avoid mounting `~` (home directory root) or system directories.

## Typical use cases

- Code editing and refactoring across a project
- Reading documentation and config files
- Creating output files (reports, summaries, generated code)
- Bulk file operations (rename, reorganize)

## edit_file format

The `edit_file` tool uses a custom patch format:

```json
{
  "path": "/path/to/file.ts",
  "edits": [
    {
      "oldText": "const foo = 1;",
      "newText": "const foo = 2;"
    }
  ]
}
```

Edits are applied in order. If `oldText` is not found, the edit fails.
