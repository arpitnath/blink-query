import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Blink } from './blink.js';

const TOOLS = [
  {
    name: 'blink_resolve',
    description:
      'Resolve a blink path to get a typed knowledge record. Returns SUMMARY (read it), META (follow as rules), COLLECTION (browse children), SOURCE (fetch if needed), or ALIAS (follows redirect). Use paths ending with / to browse a namespace.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: "Namespace path, e.g. 'me/background' or 'projects/orpheus/'" },
      },
      required: ['path'],
    },
  },
  {
    name: 'blink_save',
    description:
      'Save knowledge to a namespace. Type controls how agents consume it: SUMMARY (read directly), META (rules to follow), SOURCE (pointer to full content), ALIAS (redirect to another path).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: "Target namespace, e.g. 'me' or 'projects/orpheus'" },
        title: { type: 'string', description: 'Human-readable title' },
        type: {
          type: 'string',
          enum: ['SUMMARY', 'META', 'SOURCE', 'ALIAS'],
          description: 'Record type (default: SUMMARY)',
        },
        summary: { type: 'string', description: 'The content text' },
        content: { type: 'object', description: 'Structured content (for META: key-value, SOURCE: {url}, ALIAS: {target})' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for search' },
        ttl: { type: 'integer', description: 'TTL in seconds (default: 2592000 = 30 days)' },
      },
      required: ['namespace', 'title'],
    },
  },
  {
    name: 'blink_search',
    description: 'Search for records by keywords. Returns records matching any of the given keywords, ranked by relevance.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keywords: { type: 'string', description: 'Space-separated keywords' },
        namespace: { type: 'string', description: 'Limit search to this namespace' },
        limit: { type: 'integer', description: 'Max results (default: 10)' },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'blink_list',
    description: 'List all records in a namespace. Shows titles, types, and stats.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        namespace: { type: 'string', description: "Namespace to list, e.g. 'projects/' or 'knowledge/'" },
        sort: { type: 'string', enum: ['recent', 'hits', 'title'], description: 'Sort order (default: recent)' },
      },
      required: ['namespace'],
    },
  },
  {
    name: 'blink_query',
    description:
      "Execute a Blink query. Examples: \"discoveries where tag='auth' order by hit_count desc limit 5\", \"sessions since '2026-02-01'\", \"files where contains='authentication' limit 5\"",
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Blink query string' },
      },
      required: ['query'],
    },
  },
];

function jsonResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export async function startMCPServer(dbPath?: string): Promise<void> {
  const blink = new Blink({ dbPath });

  const server = new Server(
    { name: 'blink-query', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'blink_resolve': {
        const path = args?.path as string;
        if (!path) throw new McpError(ErrorCode.InvalidParams, 'path is required');
        const result = blink.resolve(path);
        return jsonResponse(result);
      }

      case 'blink_save': {
        const namespace = args?.namespace as string;
        const title = args?.title as string;
        if (!namespace || !title) throw new McpError(ErrorCode.InvalidParams, 'namespace and title are required');
        const record = blink.save({
          namespace,
          title,
          type: (args?.type as string as any) || 'SUMMARY',
          summary: args?.summary as string,
          content: args?.content,
          tags: args?.tags as string[],
          ttl: args?.ttl as number,
        });
        return jsonResponse({ status: 'saved', record });
      }

      case 'blink_search': {
        const keywordsStr = args?.keywords as string;
        if (!keywordsStr) throw new McpError(ErrorCode.InvalidParams, 'keywords is required');
        const results = blink.search(keywordsStr, args?.namespace as string, (args?.limit as number) || 10);
        return jsonResponse({ count: results.length, results });
      }

      case 'blink_list': {
        const namespace = args?.namespace as string;
        if (!namespace) throw new McpError(ErrorCode.InvalidParams, 'namespace is required');
        const results = blink.list(namespace, (args?.sort as 'recent' | 'hits' | 'title') || 'recent');
        return jsonResponse({ count: results.length, results });
      }

      case 'blink_query': {
        const query = args?.query as string;
        if (!query) throw new McpError(ErrorCode.InvalidParams, 'query is required');
        try {
          const results = blink.query(query);
          return jsonResponse({ count: results.length, results });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new McpError(ErrorCode.InvalidParams, `Query parse error: ${message}`);
        }
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
