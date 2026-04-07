---
title: "MCP Server — Linear"
source_url: https://github.com/jerhadf/linear-mcp-server
date: 2025-01-10
type: SOURCE
---

# MCP Server — Linear

Community MCP server for Linear, the issue tracking tool popular with engineering teams.
Written by jerhadf, this is the most-cited Linear MCP implementation.

## Installation

```bash
npm install -g linear-mcp-server

# Or via npx
{
  "mcpServers": {
    "linear": {
      "command": "npx",
      "args": ["linear-mcp-server"],
      "env": { "LINEAR_API_KEY": "lin_api_..." }
    }
  }
}
```

## Authentication

Get a Personal API Key from Linear Settings > API > Personal API keys.

## Tools exposed

| Tool | Description |
|------|-------------|
| `linear_create_issue` | Create a new issue |
| `linear_update_issue` | Update issue status, assignee, priority |
| `linear_search_issues` | Search issues by keyword |
| `linear_get_issue` | Get full issue details |
| `linear_list_teams` | List workspace teams |
| `linear_list_projects` | List projects |
| `linear_add_comment` | Comment on an issue |
| `linear_list_cycles` | List sprint cycles |

## Common workflows with AI

**Sprint planning**:
> "Show me all high-priority bugs assigned to me in the current sprint"

**Issue triage**:
> "Create issues for each item in this bug report, assign to the backend team, priority medium"

**Status reporting**:
> "Summarize what the frontend team has completed this week"

## Linear GraphQL API note

The server is a wrapper over Linear's GraphQL API. Complex queries (e.g., issues with
sub-issues, relations) may require multiple tool calls. The search uses Linear's own
search engine, not full-text across descriptions.

## Comparison to Jira MCP

Linear's API is cleaner and more predictable than Jira's. The Linear MCP server tends
to work more reliably because the underlying API returns structured, consistent data
rather than the inconsistent formats Jira uses across project types.
