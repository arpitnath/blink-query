import type Database from 'better-sqlite3';
import type { BlinkRecord, ResolveResponse } from './types.js';
import { getByPath, list, incrementHit } from './store.js';

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
    return { status: 'NXDOMAIN', record: null };
  }

  // Follow ALIAS chain
  if (record.type === 'ALIAS') {
    const target = (record.content as { target: string })?.target;
    if (!target) return { status: 'NXDOMAIN', record: null };
    return resolve(db, target, depth + 1);
  }

  // Increment hit count
  incrementHit(db, path);

  return { status: 'OK', record };
}

function resolveCollection(db: Database, namespacePath: string): ResolveResponse {
  const ns = namespacePath.replace(/\/$/, '');
  const children = list(db, ns, 'recent', 100);

  if (children.length === 0) {
    return { status: 'NXDOMAIN', record: null };
  }

  // Auto-generate a COLLECTION record
  const collectionRecord: BlinkRecord = {
    id: 'auto',
    path: namespacePath,
    namespace: ns,
    title: ns.split('/').pop() || ns,
    type: 'COLLECTION',
    summary: `${children.length} records in ${ns}/`,
    content: children.map(c => ({
      path: c.path,
      title: c.title,
      type: c.type,
      hit_count: c.hit_count,
    })),
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
