---
title: "MCP vs Function Calling — How They Differ"
type: SUMMARY
tags:
  - mcp
  - function-calling
  - topic-page
  - comparison
---

# MCP vs Function Calling

Both MCP and function calling let LLMs invoke external tools, but they solve different
problems and coexist in most modern stacks.

## Function calling

Function calling is an LLM provider feature. The app defines a set of tool schemas,
passes them to the model with the prompt, and parses the model's tool-call response.
The app itself executes the tool and returns the result to the LLM.

- **Scope**: per-request, per-app
- **Binding**: tight — the app must implement each tool
- **Distribution**: the app author writes the tools; users can't add new ones at runtime

## MCP

MCP decouples tool implementation from the host app. A server is a separate process
that declares tools via a standardised protocol. The host picks up any MCP server the
user configures, discovers its tools, and routes calls to it.

- **Scope**: installed servers persist across sessions and apps
- **Binding**: loose — servers are swappable
- **Distribution**: anyone can publish an MCP server; users can add any server to any host

## When each is right

**Use function calling when**:

- Tools are internal to the app and don't need to be reused
- Latency matters (in-process is faster than IPC/network)
- Tool definitions change per-request based on context

**Use MCP when**:

- You want tools to work across multiple LLM hosts
- Users should be able to add their own tools
- The tool needs persistent state (e.g. file system access, database connections)
- You're building a general-purpose assistant that might use dozens of tools

In practice, most modern LLM hosts support both: function calling for built-in capabilities,
MCP for user-configured external tools.

## Sources drawn from

- [[mcp-vs-function-calling]]
- [[mcp-tools-resources-prompts]]
- [[mcp-specification-overview]]
