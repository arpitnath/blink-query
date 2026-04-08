---
title: "MCP Python SDK — Building Servers"
source_url: https://github.com/modelcontextprotocol/python-sdk
date: 2025-01-20
type: SOURCE
---

# MCP Python SDK

The official Python SDK for building MCP clients and servers. Package: `mcp`

## Installation

```bash
pip install mcp
# or with uv
uv add mcp
```

## Building a minimal server

```python
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp import types
import asyncio

server = Server("my-server")

@server.list_tools()
async def list_tools() -> list[types.Tool]:
    return [
        types.Tool(
            name="add",
            description="Add two numbers",
            inputSchema={
                "type": "object",
                "properties": {
                    "a": {"type": "number"},
                    "b": {"type": "number"},
                },
                "required": ["a", "b"],
            },
        )
    ]

@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[types.TextContent]:
    if name == "add":
        result = arguments["a"] + arguments["b"]
        return [types.TextContent(type="text", text=str(result))]
    raise ValueError(f"Unknown tool: {name}")

async def main():
    async with stdio_server() as (read, write):
        await server.run(read, write, server.create_initialization_options())

asyncio.run(main())
```

## FastMCP — high-level API

Python also has `FastMCP`, a higher-level API similar to FastAPI:

```python
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("my-server")

@mcp.tool()
def add(a: int, b: int) -> int:
    """Add two numbers"""
    return a + b

@mcp.resource("config://settings")
def get_settings() -> str:
    """Get app settings"""
    return '{"theme": "dark"}'

mcp.run()
```

FastMCP handles type inference from Python type annotations — no manual schema needed.

## Transports

```python
# stdio
from mcp.server.stdio import stdio_server

# SSE
from mcp.server.sse import SseServerTransport
```

## Key differences from TypeScript SDK

| Aspect | Python | TypeScript |
|--------|--------|-----------|
| High-level API | FastMCP | McpServer |
| Type inference | Python types | Zod schemas |
| Transport | asyncio | Node.js streams |
| Package | `mcp` | `@modelcontextprotocol/sdk` |

Both implement the same protocol — servers in either language are interoperable
with any MCP client.
