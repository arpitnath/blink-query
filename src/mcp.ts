import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Blink } from './blink.js';
import {
  WIKI_DERIVERS,
  GITHUB_DERIVERS,
  FILESYSTEM_DERIVERS,
  WEB_DERIVERS,
  GIT_DERIVERS,
  POSTGRES_DERIVERS,
  extractiveSummarize,
} from './ingest.js';
import type { RecordType, IngestDocument, IngestOptions } from './types.js';

// Input validation limits
const MAX_PATH_LENGTH = 500;
const MAX_TITLE_LENGTH = 1000;
const MAX_SUMMARY_LENGTH = 100_000; // 100KB
const MAX_QUERY_LENGTH = 5000;
const MAX_KEYWORDS_LENGTH = 1000;
const MAX_INGEST_DOCS = 1000;
const MAX_INGEST_TEXT_LENGTH = 1_000_000; // 1MB per doc

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
          enum: ['SUMMARY', 'META', 'COLLECTION', 'SOURCE', 'ALIAS'],
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
        limit: { type: 'integer', description: 'Max results (default: 10, max: 200)' },
        offset: { type: 'integer', description: 'Number of results to skip (default: 0)' },
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
        limit: { type: 'integer', description: 'Max results (default: 50, max: 200)' },
        offset: { type: 'integer', description: 'Number of results to skip (default: 0)' },
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
  {
    name: 'blink_get',
    description: 'Get a record by exact path (no resolution, no ALIAS following). Returns null if not found.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: "Exact record path, e.g. 'me/background'" },
      },
      required: ['path'],
    },
  },
  {
    name: 'blink_delete',
    description: 'Delete a record by path. Returns true if deleted, false if not found.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Path of record to delete' },
      },
      required: ['path'],
    },
  },
  {
    name: 'blink_move',
    description: 'Move/rename a record from one path to another.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        from: { type: 'string', description: 'Current path' },
        to: { type: 'string', description: 'New path' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'blink_zones',
    description: 'List all zones (top-level namespaces) with record counts and metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
  },
  {
    name: 'blink_ingest',
    description:
      'Ingest a batch of documents using a deriver preset. Each document is classified, summarized, and saved as a typed record. Supports the LLM wiki pattern via the "wiki" preset (default), which auto-extracts [[wikilinks]] as ALIAS records.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        documents: {
          type: 'array',
          description: 'Documents to ingest (max 1000 per call)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Optional stable identifier' },
              text: { type: 'string', description: 'Document text content' },
              metadata: { type: 'object', description: 'Optional metadata (file_name, file_path, frontmatter, etc.)' },
            },
            required: ['text'],
          },
        },
        preset: {
          type: 'string',
          enum: ['wiki', 'github', 'filesystem', 'web', 'git', 'postgres'],
          description: 'Deriver preset (default: wiki)',
        },
        extractLinks: {
          type: 'boolean',
          description: 'For the wiki preset: extract [[wikilinks]] into ALIAS records (default: true)',
        },
        namespace: {
          type: 'string',
          description: 'Optional explicit namespace override for all documents',
        },
      },
      required: ['documents'],
    },
  },
];

function jsonResponse(data: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

export async function startMCPServer(dbPath?: string): Promise<void> {
  const blink = new Blink({ dbPath });

  const server = new Server(
    { name: 'blink-query', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'blink_resolve': {
        const path = args?.path as string;
        if (!path) throw new McpError(ErrorCode.InvalidParams, 'path is required');
        if (path.length > MAX_PATH_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `path exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        const result = blink.resolve(path);
        return jsonResponse(result);
      }

      case 'blink_save': {
        const namespace = args?.namespace as string;
        const title = args?.title as string;
        if (!namespace || !title) throw new McpError(ErrorCode.InvalidParams, 'namespace and title are required');

        // Validate string lengths
        if (namespace.length > MAX_PATH_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `namespace exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        if (title.length > MAX_TITLE_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `title exceeds maximum length of ${MAX_TITLE_LENGTH} characters`);
        }
        const summary = args?.summary as string;
        if (summary && summary.length > MAX_SUMMARY_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `summary exceeds maximum length of ${MAX_SUMMARY_LENGTH} characters`);
        }

        // Validate RecordType
        const VALID_TYPES = ['SUMMARY', 'META', 'COLLECTION', 'SOURCE', 'ALIAS'];
        const typeArg = args?.type as string;
        if (typeArg && !VALID_TYPES.includes(typeArg)) {
          throw new McpError(ErrorCode.InvalidParams, `Invalid type: ${typeArg}. Must be one of: ${VALID_TYPES.join(', ')}`);
        }
        const type = (typeArg || 'SUMMARY') as RecordType;

        const record = blink.save({
          namespace,
          title,
          type,
          summary,
          content: args?.content,
          tags: args?.tags as string[],
          ttl: args?.ttl as number,
        });
        return jsonResponse({ status: 'saved', record });
      }

      case 'blink_search': {
        const keywordsStr = args?.keywords as string;
        if (!keywordsStr) throw new McpError(ErrorCode.InvalidParams, 'keywords is required');
        if (keywordsStr.length > MAX_KEYWORDS_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `keywords exceed maximum length of ${MAX_KEYWORDS_LENGTH} characters`);
        }
        const namespace = args?.namespace as string;
        if (namespace && namespace.length > MAX_PATH_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `namespace exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        const limit = Math.min((args?.limit as number) || 10, 200);
        const offset = (args?.offset as number) || 0;
        const results = blink.search(keywordsStr, { namespace, limit, offset });
        return jsonResponse({ count: results.length, results, offset, limit });
      }

      case 'blink_list': {
        const namespace = args?.namespace as string;
        if (!namespace) throw new McpError(ErrorCode.InvalidParams, 'namespace is required');
        if (namespace.length > MAX_PATH_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `namespace exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        const limit = Math.min((args?.limit as number) || 50, 200);
        const offset = (args?.offset as number) || 0;
        const results = blink.list(namespace, (args?.sort as 'recent' | 'hits' | 'title') || 'recent', { limit, offset });
        return jsonResponse({ count: results.length, results, offset, limit });
      }

      case 'blink_query': {
        const query = args?.query as string;
        if (!query) throw new McpError(ErrorCode.InvalidParams, 'query is required');
        if (query.length > MAX_QUERY_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `query exceeds maximum length of ${MAX_QUERY_LENGTH} characters`);
        }
        try {
          const results = blink.query(query);
          return jsonResponse({ count: results.length, results });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          throw new McpError(ErrorCode.InvalidParams, `Query parse error: ${message}`);
        }
      }

      case 'blink_get': {
        const path = args?.path as string;
        if (!path) throw new McpError(ErrorCode.InvalidParams, 'path is required');
        if (path.length > MAX_PATH_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `path exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        const record = blink.get(path);
        if (record) {
          return jsonResponse({ record });
        } else {
          return jsonResponse({ status: 'not_found' });
        }
      }

      case 'blink_delete': {
        const path = args?.path as string;
        if (!path) throw new McpError(ErrorCode.InvalidParams, 'path is required');
        if (path.length > MAX_PATH_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `path exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        const deleted = blink.delete(path);
        return jsonResponse({ deleted });
      }

      case 'blink_move': {
        const from = args?.from as string;
        const to = args?.to as string;
        if (!from || !to) throw new McpError(ErrorCode.InvalidParams, 'from and to are required');
        if (from.length > MAX_PATH_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `from path exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        if (to.length > MAX_PATH_LENGTH) {
          throw new McpError(ErrorCode.InvalidParams, `to path exceeds maximum length of ${MAX_PATH_LENGTH} characters`);
        }
        const record = blink.move(from, to);
        if (record) {
          return jsonResponse({ moved: true, record });
        } else {
          return jsonResponse({ moved: false });
        }
      }

      case 'blink_zones': {
        const zones = blink.zones();
        return jsonResponse({ count: zones.length, zones });
      }

      case 'blink_ingest': {
        const documents = args?.documents as Array<{ id?: string; text: string; metadata?: Record<string, unknown> }>;
        if (!Array.isArray(documents)) {
          throw new McpError(ErrorCode.InvalidParams, 'documents must be an array');
        }
        if (documents.length === 0) {
          throw new McpError(ErrorCode.InvalidParams, 'documents must not be empty');
        }
        if (documents.length > MAX_INGEST_DOCS) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `documents exceeds maximum of ${MAX_INGEST_DOCS} per call`,
          );
        }

        // Validate each doc and assign defaults
        const docs: IngestDocument[] = documents.map((d, i) => {
          if (typeof d.text !== 'string') {
            throw new McpError(ErrorCode.InvalidParams, `documents[${i}].text must be a string`);
          }
          if (d.text.length > MAX_INGEST_TEXT_LENGTH) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `documents[${i}].text exceeds maximum length of ${MAX_INGEST_TEXT_LENGTH}`,
            );
          }
          return {
            id: d.id ?? `mcp-${Date.now()}-${i}`,
            text: d.text,
            metadata: d.metadata ?? {},
          };
        });

        const presetArg = (args?.preset as string) ?? 'wiki';
        const PRESETS: Record<string, IngestOptions> = {
          wiki: { ...WIKI_DERIVERS, extractLinks: true },
          github: { ...GITHUB_DERIVERS },
          filesystem: { ...FILESYSTEM_DERIVERS },
          web: { ...WEB_DERIVERS },
          git: { ...GIT_DERIVERS },
          postgres: { ...POSTGRES_DERIVERS },
        };
        const preset = PRESETS[presetArg];
        if (!preset) {
          throw new McpError(
            ErrorCode.InvalidParams,
            `Invalid preset: ${presetArg}. Must be one of: ${Object.keys(PRESETS).join(', ')}`,
          );
        }

        // Override extractLinks if explicitly provided
        if (typeof args?.extractLinks === 'boolean') {
          preset.extractLinks = args.extractLinks;
        }

        // Optional namespace override
        const namespaceOverride = args?.namespace as string | undefined;
        if (namespaceOverride) {
          if (namespaceOverride.length > MAX_PATH_LENGTH) {
            throw new McpError(
              ErrorCode.InvalidParams,
              `namespace exceeds maximum length of ${MAX_PATH_LENGTH}`,
            );
          }
          preset.namespace = namespaceOverride;
        }

        // Always provide a default summarizer (extractive — no API key required)
        if (!preset.summarize) {
          preset.summarize = extractiveSummarize(500);
        }

        const result = await blink.ingest(docs, preset);
        return jsonResponse({
          count: result.records.length,
          total: result.total,
          elapsed: result.elapsed,
          aliasesCreated: result.aliasesCreated,
          unresolvedLinks: result.unresolvedLinks,
          errors: result.errors.map(e => ({ id: e.document.id, error: e.error.message })),
          records: result.records.map(r => ({ path: r.path, type: r.type, title: r.title })),
        });
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
