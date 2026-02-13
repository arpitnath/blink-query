import Database from 'better-sqlite3';
import { initDB, save, saveMany, getByPath, list, deleteRecord, move, searchByKeywords, listZones, slug } from './store.js';
import { resolve } from './resolver.js';
import { executeQuery } from './query-executor.js';
import { processDocuments, loadDirectory, extractiveSummarize } from './ingest.js';
import { loadFromPostgres, loadFromUrls } from './adapters.js';
import type { BlinkRecord, SaveInput, Zone, ResolveResponse, IngestDocument, IngestOptions, IngestResult, PostgresLoadConfig, WebLoadConfig } from './types.js';

export interface BlinkOptions {
  dbPath?: string;
}

export class Blink {
  private db: InstanceType<typeof Database>;

  constructor(options?: BlinkOptions) {
    this.db = initDB(options?.dbPath);
  }

  /** Save a knowledge record */
  save(input: SaveInput): BlinkRecord {
    return save(this.db, input);
  }

  /** Save multiple records in a single transaction */
  saveMany(inputs: SaveInput[]): BlinkRecord[] {
    return saveMany(this.db, inputs);
  }

  /** Resolve a path (follows ALIASes, auto-generates COLLECTIONs) */
  resolve(path: string): ResolveResponse {
    return resolve(this.db, path);
  }

  /** Preview the path that would be generated for a given namespace and title */
  pathFor(namespace: string, title: string): string {
    return `${namespace}/${slug(title)}`;
  }

  /** Search by space-separated keywords */
  search(keywords: string, options?: { namespace?: string; limit?: number }): BlinkRecord[] {
    const kws = keywords.split(/\s+/).filter(Boolean);
    return searchByKeywords(this.db, kws, options?.namespace, options?.limit);
  }

  /** List records in a namespace */
  list(namespace: string, sort?: 'recent' | 'hits' | 'title'): BlinkRecord[] {
    return list(this.db, namespace, sort);
  }

  /** Execute a Blink query string */
  query(queryString: string): BlinkRecord[] {
    return executeQuery(this.db, queryString);
  }

  /** List all zones */
  zones(): Zone[] {
    return listZones(this.db);
  }

  /** Delete a record by path */
  delete(path: string): boolean {
    return deleteRecord(this.db, path);
  }

  /** Move a record from one path to another */
  move(fromPath: string, toPath: string): BlinkRecord | null {
    return move(this.db, fromPath, toPath);
  }

  /** Get a record by exact path (no resolution) */
  get(path: string): BlinkRecord | null {
    return getByPath(this.db, path);
  }

  /** Ingest documents (from LlamaIndex or any loader) into Blink records */
  async ingest(docs: IngestDocument[], options: IngestOptions): Promise<IngestResult> {
    return processDocuments(this, docs, options);
  }

  /** Load and ingest a directory in one call. Uses LlamaIndex if installed, else basic fs loader. */
  async ingestDirectory(
    dirPath: string,
    options: IngestOptions,
    loadOptions?: { recursive?: boolean; extensions?: string[] },
  ): Promise<IngestResult> {
    const docs = await loadDirectory(dirPath, loadOptions);
    return this.ingest(docs, options);
  }

  /** Load rows from PostgreSQL and ingest as Blink records */
  async ingestFromPostgres(config: PostgresLoadConfig, options: IngestOptions): Promise<IngestResult> {
    const docs = await loadFromPostgres(config);
    return this.ingest(docs, options);
  }

  /** Load web pages from URLs and ingest as Blink records */
  async ingestFromUrls(
    urls: string[],
    options: IngestOptions,
    loadOptions?: Omit<WebLoadConfig, 'urls'>,
  ): Promise<IngestResult> {
    const docs = await loadFromUrls(urls, loadOptions);
    return this.ingest(docs, options);
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}

// Re-export types for consumers
export type {
  BlinkRecord, SaveInput, Zone, ResolveResponse, RecordType, Source, QueryAST, QueryCondition,
  IngestDocument, IngestOptions, IngestResult, SummarizeCallback, ClassifyCallback,
  DeriveNamespaceCallback, DeriveTitleCallback, DeriveTagsCallback, BuildSourcesCallback,
  PostgresLoadConfig, WebLoadConfig, LLMConfig,
} from './types.js';

// Re-export ingestion helpers
export { loadDirectory, extractiveSummarize } from './ingest.js';

// Re-export preset derivers
export {
  FILESYSTEM_DERIVERS,
  filesystemNamespace, filesystemTitle, filesystemTags, filesystemSources,
  POSTGRES_DERIVERS,
  postgresNamespace, postgresTitle, postgresTags, postgresSources,
  WEB_DERIVERS,
  webNamespace, webTitle, webTags, webSources,
  GIT_DERIVERS,
  gitNamespace, gitTitle, gitTags, gitSources,
} from './ingest.js';

// Re-export adapter functions
export { loadFromPostgres, loadFromUrls } from './adapters.js';

// Re-export adapter utilities
export { stripHtml, parseUrl } from './adapters.js';

// Re-export LLM helpers
export { llmSummarize, llmClassify } from './llm.js';
