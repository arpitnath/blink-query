// Record types — the core innovation
export type RecordType = 'SUMMARY' | 'META' | 'COLLECTION' | 'SOURCE' | 'ALIAS';

// The core Blink record
export interface BlinkRecord {
  id: string;
  path: string;
  namespace: string;
  title: string;
  type: RecordType;
  summary: string | null;
  content: unknown | null;
  ttl: number;
  created_at: string;
  updated_at: string;
  content_hash: string;
  tags: string[];
  token_count: number;
  hit_count: number;
  last_hit: string | null;
  sources: Source[];
}

export interface Source {
  type: 'web' | 'file' | 'manual';
  url?: string;
  file_path?: string;
  last_fetched?: string;
}

// Zone (SOA equivalent)
export interface Zone {
  path: string;
  description: string | null;
  default_ttl: number;
  record_count: number;
  created_at: string;
  last_modified: string;
}

// Query AST (output of Peggy parser)
export interface QueryAST {
  resource: string;
  where?: QueryCondition[];
  orderBy?: { field: string; direction: 'asc' | 'desc' };
  limit?: number;
  since?: string;
}

export interface QueryCondition {
  field: string;
  op: '=' | '!=' | '>' | '<' | '>=' | '<=' | 'contains';
  value: string | number;
}

// Resolution response
export interface ResolveResponse {
  status: 'OK' | 'NXDOMAIN' | 'STALE' | 'ALIAS_LOOP';
  record: BlinkRecord | null;
}

// Input for save operations
export interface SaveInput {
  namespace: string;
  title: string;
  type?: RecordType;
  summary?: string;
  content?: unknown;
  tags?: string[];
  ttl?: number;
  sources?: Source[];
}
