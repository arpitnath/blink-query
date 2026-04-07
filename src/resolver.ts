import type Database from 'better-sqlite3';
import type { BlinkRecord, RecordType, ResolveResponse } from './types.js';
import { getByPath, list, incrementHit, countByNamespace, findSuggestions } from './store.js';

const MAX_ALIAS_HOPS = 5;

export function resolve(db: Database, path: string, depth = 0): ResolveResponse {
  if (depth > MAX_ALIAS_HOPS) {
    return { status: 'ALIAS_LOOP', record: null };
  }

  // Namespace path (ends with /) → auto-generate COLLECTION
  if (path.endsWith('/')) {
    return resolveCollection(db, path);
  }

  const record = getByPath(db, path);
  if (!record) {
    // Try as namespace (maybe user omitted trailing slash)
    const asCollection = resolveCollection(db, path + '/');
    if (asCollection.status === 'OK') return asCollection;
    const parentNs = path.includes('/') ? path.split('/').slice(0, -1).join('/') : path;
    const suggestions = findSuggestions(db, path, parentNs);
    return { status: 'NXDOMAIN', record: null, suggestions: suggestions as Array<{ path: string; title: string; type: RecordType }> };
  }

  // Follow ALIAS chain
  if (record.type === 'ALIAS') {
    const content = record.content as { target?: string } | null;
    const target = content?.target;
    if (!target || typeof target !== 'string') {
      return { status: 'NXDOMAIN' as const, record: null };
    }
    return resolve(db, target, depth + 1);
  }

  // Check TTL for staleness
  const age = (Date.now() - new Date(record.updated_at).getTime()) / 1000;
  if (record.ttl > 0 && age > record.ttl) {
    incrementHit(db, path);  // still count the hit
    return { status: 'STALE', record };
  }

  // Increment hit count
  incrementHit(db, path);

  return { status: 'OK', record };
}

function resolveCollection(db: Database, namespacePath: string): ResolveResponse {
  const ns = namespacePath.replace(/\/$/, '');
  const children = list(db, ns, 'hits', 20);

  if (children.length === 0) {
    return { status: 'NXDOMAIN', record: null };
  }

  const totalCount = countByNamespace(db, ns);

  // Auto-generate a COLLECTION record
  const collectionRecord: BlinkRecord = {
    id: 'auto',
    path: namespacePath,
    namespace: ns,
    title: ns.split('/').pop() || ns,
    type: 'COLLECTION',
    summary: `${totalCount} records in ${ns}/ (showing top 20 by usage)`,
    content: {
      items: children.map(c => ({ path: c.path, title: c.title, type: c.type, hit_count: c.hit_count })),
      total: totalCount,
      truncated: totalCount > 20,
    },
    ttl: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    content_hash: '',
    tags: [],
    token_count: 0,
    hit_count: 0,
    last_hit: null,
    sources: [],
  };

  return { status: 'OK', record: collectionRecord };
}
