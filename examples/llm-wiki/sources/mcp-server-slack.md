---
title: "MCP Server — Slack"
source_url: https://github.com/modelcontextprotocol/servers/tree/main/src/slack
date: 2024-11-25
type: SOURCE
---

# MCP Server — Slack

Official Slack MCP server from modelcontextprotocol/servers. Enables AI assistants to
read channel history, post messages, and navigate the Slack workspace.

## Installation

```bash
npx -y @modelcontextprotocol/server-slack

# Claude Desktop
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-...",
        "SLACK_TEAM_ID": "T..."
      }
    }
  }
}
```

## Slack App setup

1. Create a Slack App at api.slack.com/apps
2. Add OAuth scopes: `channels:history`, `channels:read`, `chat:write`, `users:read`
3. Install app to workspace, get the Bot OAuth Token (`xoxb-...`)
4. Find your Team ID from the workspace URL

## Tools exposed

| Tool | Description |
|------|-------------|
| `slack_list_channels` | List public channels |
| `slack_post_message` | Post a message to a channel |
| `slack_reply_to_thread` | Reply to a thread |
| `slack_add_reaction` | React to a message |
| `slack_get_channel_history` | Read recent messages |
| `slack_get_thread_replies` | Read a thread |
| `slack_get_users` | List workspace users |
| `slack_get_user_profile` | Get a user's profile |

## Common patterns

**Standup summary**:
> "Read the last 50 messages in #engineering and summarize what the team was working on"

**Cross-channel research**:
> "Search for any discussions about the auth refactor across all channels"

**Posting updates**:
> "Post a summary of today's work to #daily-standup"

## Security considerations

- The bot token has access to all channels it's been invited to
- `chat:write` allows the AI to post as the bot — consider whether auto-posting is appropriate
- Slack message history can contain sensitive information; the AI will see it all

## Limitations

- Cannot access private channels unless the bot is invited
- No file upload support in the reference implementation
- Rate limited by Slack's API tiers
