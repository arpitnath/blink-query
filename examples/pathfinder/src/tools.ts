/**
 * Blink-query tools for pi-ai agents.
 *
 * Exposes blink-query operations as pi-ai Tool definitions
 * with a shared executor function.
 */

import { Type } from '@mariozechner/pi-ai';
import type { Tool } from '@mariozechner/pi-ai';
import { Blink } from 'blink-query';
import type { RecordType } from 'blink-query';

// --- Tool definitions ---

export const blinkTools: Tool[] = [
  {
    name: 'blink_resolve',
    description:
      'Resolve a path to a typed knowledge record — like a DNS lookup. Returns the record with its type (SUMMARY, META, SOURCE, COLLECTION, ALIAS) which tells you how to consume it. Use paths ending with / to browse a namespace.',
    parameters: Type.Object({
      path: Type.String({ description: "Namespace path, e.g. 'support/billing/refund-policy' or 'support/billing/'" }),
    }),
  },
  {
    name: 'blink_save',
    description:
      'Save a knowledge record to a namespace. Type controls how agents consume it: SUMMARY (read directly), META (structured rules to follow), SOURCE (pointer to full content), ALIAS (redirect to another path).',
    parameters: Type.Object({
      namespace: Type.String({ description: "Target namespace, e.g. 'support/billing'" }),
      title: Type.String({ description: 'Human-readable title' }),
      type: Type.Optional(
        Type.Union([
          Type.Literal('SUMMARY'),
          Type.Literal('META'),
          Type.Literal('SOURCE'),
          Type.Literal('ALIAS'),
          Type.Literal('COLLECTION'),
        ]),
      ),
      summary: Type.Optional(Type.String({ description: 'The content text' })),
      tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for search' })),
    }),
  },
  {
    name: 'blink_search',
    description: 'Search for knowledge records by keywords. Returns records ranked by relevance (BM25).',
    parameters: Type.Object({
      keywords: Type.String({ description: 'Space-separated search keywords' }),
      limit: Type.Optional(Type.Number({ description: 'Max results (default: 5)' })),
    }),
  },
  {
    name: 'blink_list',
    description: 'List all records in a namespace. Use this to explore what knowledge exists.',
    parameters: Type.Object({
      namespace: Type.String({ description: "Namespace to list, e.g. 'support/' or 'projects/'" }),
    }),
  },
  {
    name: 'blink_zones',
    description:
      'List all top-level namespaces (zones) in the knowledge base. Use this first to discover what domains of knowledge exist before resolving or searching.',
    parameters: Type.Object({}),
  },
];

// --- Tool executor ---

export function createBlinkExecutor(blink: Blink) {
  return function executeBlinkTool(name: string, args: Record<string, unknown>): string {
    switch (name) {
      case 'blink_resolve': {
        const result = blink.resolve(args.path as string);
        if (result.status === 'NXDOMAIN') {
          return JSON.stringify({
            status: 'NXDOMAIN',
            message: `No record found at "${args.path as string}"`,
            suggestions: result.suggestions ?? [],
          });
        }
        if (result.status === 'ALIAS_LOOP') {
          return JSON.stringify({ status: 'ALIAS_LOOP', message: 'Circular alias chain detected' });
        }
        return JSON.stringify(result, null, 2);
      }

      case 'blink_save': {
        const record = blink.save({
          namespace: args.namespace as string,
          title: args.title as string,
          type: (args.type as RecordType) || 'SUMMARY',
          summary: args.summary as string | undefined,
          tags: args.tags as string[] | undefined,
        });
        return JSON.stringify({ saved: true, path: record.path, type: record.type });
      }

      case 'blink_search': {
        const results = blink.search(args.keywords as string, {
          limit: (args.limit as number) || 5,
        });
        return JSON.stringify(
          results.map((r) => ({
            path: r.path,
            title: r.title,
            type: r.type,
            summary: r.summary?.substring(0, 200),
          })),
          null,
          2,
        );
      }

      case 'blink_list': {
        const results = blink.list(args.namespace as string, 'recent', { limit: 20 });
        return JSON.stringify(
          results.map((r) => ({
            path: r.path,
            title: r.title,
            type: r.type,
          })),
          null,
          2,
        );
      }

      case 'blink_zones': {
        const zones = blink.zones();
        return JSON.stringify(
          zones.map((z) => ({
            path: z.path,
            record_count: z.record_count,
            last_modified: z.last_modified,
          })),
          null,
          2,
        );
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  };
}
