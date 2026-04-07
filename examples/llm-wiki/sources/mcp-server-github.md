---
title: "MCP Server — GitHub (Official)"
source_url: https://github.com/modelcontextprotocol/servers/tree/main/src/github
date: 2024-11-25
type: SOURCE
---

# MCP Server — GitHub

The official GitHub MCP server from modelcontextprotocol/servers. Provides read/write
access to GitHub repositories, issues, pull requests, and code search.

## Installation

```bash
# Via npx (no install)
npx -y @modelcontextprotocol/server-github

# Claude Desktop config (~/.config/claude/claude_desktop_config.json)
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "<your-token>" }
    }
  }
}
```

## Tools exposed

| Tool | Description |
|------|-------------|
| `create_or_update_file` | Create or update a file in a repository |
| `search_repositories` | Search GitHub repos |
| `create_repository` | Create a new repository |
| `get_file_contents` | Read a file from a repo |
| `push_files` | Push multiple files in one commit |
| `create_issue` | Open a new issue |
| `create_pull_request` | Open a new PR |
| `fork_repository` | Fork a repository |
| `create_branch` | Create a new branch |
| `list_commits` | List recent commits |
| `list_issues` | List repo issues |
| `update_issue` | Update an existing issue |
| `add_issue_comment` | Comment on an issue |
| `search_code` | Search code across GitHub |
| `search_issues` | Search issues |

## Authentication

Requires a GitHub Personal Access Token (PAT) with appropriate scopes:
- `repo` — full repo access (read + write)
- `read:org` — for org-level operations

Set via `GITHUB_PERSONAL_ACCESS_TOKEN` environment variable.

## Usage notes

- File creation uses base64 encoding for content
- Branch operations require the target repo to exist
- Code search uses GitHub's code search API (rate limited)
- The server does not support GitHub Apps authentication (PAT only)

## Common patterns

**Read and summarize an issue**:
> "Read the latest issues in vercel/next.js and summarize the top bugs"

**Code exploration**:
> "Search for all files using the deprecated pages router in my repo"

**PR workflow**:
> "Create a branch, push my changes, and open a draft PR"
