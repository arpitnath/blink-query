---
title: "MCP Sampling — LLM Access from Servers"
source_url: https://spec.modelcontextprotocol.io/specification/client/sampling/
date: 2024-11-25
type: SOURCE
---

# MCP Sampling

Sampling is an MCP capability that allows servers to request LLM completions from the
client. It inverts the usual flow: instead of the client calling the server's tools,
the server calls the client's AI.

## Why sampling exists

Some server operations need AI to complete — for example, a code review server might
want to ask the AI to score a diff, or a summarization server might need to compress
retrieved text. Without sampling, the server would need its own LLM API key.

With sampling, the server can delegate LLM work to the client's existing AI session.

## The sampling request

```json
{
  "method": "sampling/createMessage",
  "params": {
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Summarize this issue in one sentence: ..."
        }
      }
    ],
    "modelPreferences": {
      "hints": [{ "name": "claude-haiku" }],
      "intelligencePriority": 0.3,
      "speedPriority": 0.8
    },
    "systemPrompt": "You are a concise summarizer.",
    "maxTokens": 100
  }
}
```

The client handles this request by calling the LLM and returning the result to the server.

## Human-in-the-loop requirement

The spec explicitly requires that clients show sampling requests to users for approval
before executing them. This prevents servers from using the LLM without user awareness.

Hosts that support sampling must implement a UI confirmation step.

## Model preferences

`modelPreferences` is a hint, not a mandate. The client chooses the actual model.
Preferences include:
- `hints`: Preferred model names (client can ignore)
- `intelligencePriority`: 0.0 (speed) to 1.0 (quality)
- `speedPriority`: 0.0 to 1.0
- `costPriority`: 0.0 to 1.0

## Current adoption

As of early 2025, sampling is declared in the spec but few production servers use it.
Most servers perform their own LLM calls via API keys rather than using client sampling.

Sampling is primarily useful in "agentic" scenarios where the server is orchestrating
a multi-step workflow and needs AI judgment at intermediate steps.
