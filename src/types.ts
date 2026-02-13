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
  type: 'web' | 'file' | 'database' | 'api' | 'vcs' | string;
  url?: string;
  file_path?: string;
  last_fetched?: string;
  /** Database connection/table info */
  connection_string?: string;
  table?: string;
  query?: string;
  /** API endpoint info */
  endpoint?: string;
  method?: string;
  /** VCS info */
  repo?: string;
  ref?: string;
  /** Arbitrary source-specific metadata */
  [key: string]: unknown;
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

// ─── Ingestion types ────────────────────────────────────────

/** Generic document interface for ingestion. Compatible with LlamaIndex Document but doesn't import it. */
export interface IngestDocument {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

/** Callback to produce a summary from document text. Developers bring their own LLM or use extractive logic. */
export type SummarizeCallback = (
  text: string,
  metadata: Record<string, unknown>,
) => string | Promise<string>;

/** Optional callback to classify a document into a RecordType. Defaults to SOURCE if not provided. */
export type ClassifyCallback = (
  text: string,
  metadata: Record<string, unknown>,
) => RecordType | Promise<RecordType>;

/** Callback to derive a namespace from document metadata. */
export type DeriveNamespaceCallback = (
  metadata: Record<string, unknown>,
) => string;

/** Callback to derive a title from document metadata. */
export type DeriveTitleCallback = (
  metadata: Record<string, unknown>,
) => string;

/** Callback to derive tags from document metadata and extra user tags. */
export type DeriveTagsCallback = (
  metadata: Record<string, unknown>,
  extraTags?: string[],
) => string[];

/** Callback to build source references from document metadata. */
export type BuildSourcesCallback = (
  metadata: Record<string, unknown>,
) => Source[];

/** Options for blink.ingest() */
export interface IngestOptions {
  /** Optional: produces a summary string from document text (defaults to extractive summarizer) */
  summarize?: SummarizeCallback;
  /** Optional: classifies document into a RecordType (default: SOURCE) */
  classify?: ClassifyCallback;
  /** Optional: explicit namespace string or function deriving namespace from metadata */
  namespace?: string | ((metadata: Record<string, unknown>) => string);
  /** Optional: namespace prefix to prepend (e.g., "ingested") */
  namespacePrefix?: string;
  /** Optional: TTL for all ingested records */
  ttl?: number;
  /** Optional: additional tags to apply to all records */
  tags?: string[];
  /** Optional: concurrency for async summarize/classify calls (default: 5) */
  concurrency?: number;
  /** Optional: source type label (e.g., 'file', 'database', 'api', 'web') */
  sourceType?: string;
  /** Optional: custom namespace derivation callback */
  deriveNamespace?: DeriveNamespaceCallback;
  /** Optional: custom title derivation callback */
  deriveTitle?: DeriveTitleCallback;
  /** Optional: custom tag derivation callback */
  deriveTags?: DeriveTagsCallback;
  /** Optional: custom source reference builder callback */
  buildSources?: BuildSourcesCallback;
}

/** Result of an ingest operation */
export interface IngestResult {
  records: BlinkRecord[];
  errors: Array<{ document: IngestDocument; error: Error }>;
  total: number;
  elapsed: number;
}
