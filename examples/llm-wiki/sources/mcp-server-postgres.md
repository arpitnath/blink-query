---
title: "MCP Server — PostgreSQL (Official)"
source_url: https://github.com/modelcontextprotocol/servers/tree/main/src/postgres
date: 2024-11-25
type: SOURCE
---

# MCP Server — PostgreSQL

Official PostgreSQL MCP server. Provides read-only SQL query access and schema introspection.

## Installation

```bash
npx -y @modelcontextprotocol/server-postgres "postgresql://user:password@localhost/mydb"

# Claude Desktop
{
  "mcpServers": {
    "postgres": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-postgres",
        "postgresql://user:pass@localhost/mydb"
      ]
    }
  }
}
```

## Tools exposed

| Tool | Description |
|------|-------------|
| `query` | Execute a read-only SQL query |

## Resources exposed

The server exposes each table as a resource:

```
postgres://mydb/public/users
postgres://mydb/public/orders
```

Reading a resource returns the table schema (DDL), not the row data.

## Design philosophy

The reference implementation is **intentionally read-only**. The `query` tool uses a
read-only transaction and will error on any write (`INSERT`, `UPDATE`, `DELETE`, `DROP`).

This is a considered choice: letting AI freely modify databases is dangerous. The server
is designed for analysis and exploration, not data modification.

## Schema introspection

```sql
-- The server runs this to discover tables
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public'
```

Each table becomes a resource URI. Reading the resource gives:
```sql
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Common patterns

**Data analysis**:
> "What are the top 10 products by revenue this month?"

**Schema exploration**:
> "Describe the schema of our database and the relationships between tables"

**Query building**:
> "Help me write a query to find users who haven't logged in for 30 days"

## Write-enabled alternatives

Community servers add write support. If you need writes:
- `@benborla/mcp-server-mysql` — MySQL with write support
- `crystaldba/postgres-mcp` — More comprehensive Postgres MCP
