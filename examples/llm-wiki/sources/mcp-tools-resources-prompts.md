---
title: "MCP Primitives — Tools, Resources, and Prompts"
source_url: https://spec.modelcontextprotocol.io/specification/server/
date: 2024-11-25
type: SUMMARY
---

# MCP Primitives — Tools, Resources, and Prompts

MCP servers expose capabilities through exactly three primitives. The distinction matters
because it determines who initiates the interaction and what the data is for.

## Tools (model-controlled)

Tools are functions the AI model decides to call. They're the most powerful and most
commonly implemented primitive — equivalent to "function calling" but standardized.

```json
{
  "name": "read_file",
  "description": "Read contents of a file",
  "inputSchema": {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Absolute file path" }
    },
    "required": ["path"]
  }
}
```

**When to use tools**: Any action the model needs to take — file I/O, API calls, database
queries, shell commands. Tools can have side effects.

**Tool result structure**:
```json
{
  "content": [
    { "type": "text", "text": "file contents here" }
  ],
  "isError": false
}
```

Content blocks can be `text`, `image`, or `resource` type. Images are base64-encoded.

## Resources (application-controlled)

Resources expose data that the host application manages and can subscribe to. Unlike tools
(triggered by the model), resources are surfaced by the application and can update live.

```json
{
  "uri": "file:///home/user/.zshrc",
  "name": ".zshrc",
  "description": "Shell configuration",
  "mimeType": "text/plain"
}
```

Resource URIs are opaque to the client — the server defines the URI scheme. Common
schemes: `file://`, `git://`, `db://`, `github://`.

Resources support subscription: clients can `resources/subscribe` to a URI and receive
`resources/updated` notifications when the content changes (useful for live file watching
or database change streams).

**When to use resources**: Static or slowly-changing reference data that the application
(not the model) knows about — files, database schemas, config files, documentation.

## Prompts (user-controlled)

Prompts are reusable, parameterized message templates. The user selects a prompt (e.g.
from a slash-command menu), the client fetches it, and it becomes part of the conversation.

```json
{
  "name": "code-review",
  "description": "Review code for issues",
  "arguments": [
    { "name": "language", "description": "Programming language", "required": true }
  ]
}
```

Prompts can include embedded resources (the response includes both the messages and any
resource references to include).

**When to use prompts**: Predefined workflows, slash commands, code snippets that users
invoke repeatedly.

## The control inversion

| Primitive | Controlled by | Typical pattern |
|-----------|--------------|-----------------|
| Tool | Model | AI decides when to call `search_web()` |
| Resource | Application | Editor injects open files into context |
| Prompt | User | User runs `/code-review python` |

This three-way split is one of MCP's most thoughtful design choices: it gives each
participant (AI, app, human) the right level of control over what they own.
