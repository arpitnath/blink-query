---
title: "MCP Server — Memory (Knowledge Graph)"
source_url: https://github.com/modelcontextprotocol/servers/tree/main/src/memory
date: 2024-11-25
type: SOURCE
---

# MCP Server — Memory

Official memory MCP server. Implements a persistent knowledge graph backed by a local
JSON file, enabling AI assistants to remember information across conversations.

## Concept

Claude and other LLMs are stateless by design — each conversation starts fresh. The
Memory server provides a persistent layer: the AI can explicitly save and recall facts,
preferences, and relationships using tools.

## Installation

```bash
npx -y @modelcontextprotocol/server-memory

# With custom storage path
MEMORY_FILE_PATH=/path/to/memory.json npx -y @modelcontextprotocol/server-memory
```

## Data model

The server stores a **knowledge graph** — entities with observations and relations:

```json
{
  "entities": [
    {
      "name": "Alice",
      "entityType": "person",
      "observations": ["works at Acme Corp", "prefers Python"]
    }
  ],
  "relations": [
    { "from": "Alice", "to": "Acme Corp", "relationType": "works_at" }
  ]
}
```

## Tools exposed

| Tool | Description |
|------|-------------|
| `create_entities` | Add new entities to the graph |
| `create_relations` | Add relationships between entities |
| `add_observations` | Add facts to existing entities |
| `delete_entities` | Remove entities |
| `delete_observations` | Remove specific facts |
| `delete_relations` | Remove relationships |
| `read_graph` | Read the full knowledge graph |
| `search_nodes` | Search entities by keyword |
| `open_nodes` | Get specific entities by name |

## Usage pattern

Memory works best with a system prompt instructing the AI to use it:

```
You have access to a memory tool. At the start of each conversation, read the graph.
During the conversation, save anything useful the user mentions.
```

## Comparison to blink-query memory pattern

The Memory server stores knowledge as a flat graph. blink-query's wiki pattern stores
knowledge as typed documents (SUMMARY, META, SOURCE, etc.) with FTS search, enabling
richer retrieval semantics. The wiki pattern is better for team knowledge bases;
the Memory server is better for personal assistant memory.

## Limitations

- No semantic search — text search only
- The full graph is loaded into memory at startup (not suitable for very large graphs)
- No multi-user support; single JSON file
- No versioning or history
