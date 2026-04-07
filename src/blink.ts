import Database from 'better-sqlite3';
import { initDB, save, saveMany, getByPath, list, deleteRecord, move, searchByKeywords, listZones, slug, evictStale } from './store.js';
import { resolve } from './resolver.js';
import { executeQuery } from './query-executor.js';
import { processDocuments, loadDirectory, extractiveSummarize, POSTGRES_DERIVERS, GITHUB_DERIVERS, extractWikiLinks } from './ingest.js';
import { loadFromPostgres, loadFromPostgresProgressive, loadFromUrls, loadFromGit, loadFromGitHubIssues, introspectPostgresTable, pickTextColumn } from './adapters.js';
import type { BlinkRecord, SaveInput, Zone, ResolveResponse, IngestDocument, IngestOptions, IngestResult, PostgresLoadConfig, PostgresProgressiveConfig, PostgresIntrospection, WebLoadConfig, GitLoadConfig, GitHubLoadConfig } from './types.js';

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
  search(keywords: string, options?: { namespace?: string; limit?: number; offset?: number }): BlinkRecord[] {
    const kws = keywords.split(/\s+/).filter(Boolean);
    return searchByKeywords(this.db, kws, options?.namespace, options?.limit, options?.offset);
  }

  /** List records in a namespace */
  list(namespace: string, sort?: 'recent' | 'hits' | 'title', options?: { limit?: number; offset?: number }): BlinkRecord[] {
    return list(this.db, namespace, sort, options?.limit, options?.offset);
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
    const result = await processDocuments(this, docs, options);
    if (options.extractLinks) {
      const links = extractWikiLinks(this, result.records);
      result.aliasesCreated = links.aliasesCreated;
      result.unresolvedLinks = links.unresolvedLinks;
    }
    return result;
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

  /**
   * Progressive PostgreSQL ingestion with automatic column detection.
   *
   * Loads rows in batches using LIMIT/OFFSET, auto-detects text and ID columns
   * via introspection when not explicitly specified, and ingests each batch
   * incrementally into Blink records.
   *
   * @returns Combined IngestResult from all batches, plus the introspection data.
   */
  async ingestFromPostgresProgressive(
    config: PostgresProgressiveConfig,
    options?: IngestOptions,
  ): Promise<IngestResult & { introspection: PostgresIntrospection }> {
    const schema = config.schema || 'public';

    // Run introspection for auto-detection and metadata
    const introspection = await introspectPostgresTable(
      config.connectionString,
      config.table,
      schema,
    );

    // Auto-fill columns from introspection if not provided
    const resolvedConfig: PostgresProgressiveConfig = { ...config };
    if (!resolvedConfig.textColumn) {
      const picked = pickTextColumn(introspection);
      if (!picked) throw new Error(`No text column found in "${schema}"."${config.table}". Specify textColumn explicitly.`);
      resolvedConfig.textColumn = picked;
    }
    if (!resolvedConfig.idColumn) {
      resolvedConfig.idColumn = introspection.primaryKey || introspection.columns[0].name;
    }

    // Auto-apply POSTGRES_DERIVERS + extractiveSummarize when no options provided
    const effectiveOptions: IngestOptions = options
      ? { ...options }
      : { ...POSTGRES_DERIVERS, summarize: extractiveSummarize(500) };

    // Ingest each batch as it arrives instead of accumulating all docs in memory
    const allRecords: BlinkRecord[] = [];
    const allErrors: Array<{ document: IngestDocument; error: Error }> = [];
    let totalDocs = 0;
    const start = Date.now();

    const originalOnBatch = resolvedConfig.onBatch;
    resolvedConfig.onBatch = async (batchDocs, batchIndex, totalLoaded) => {
      // Ingest this batch immediately
      const batchResult = await this.ingest(batchDocs, effectiveOptions);
      allRecords.push(...batchResult.records);
      allErrors.push(...batchResult.errors);
      totalDocs += batchDocs.length;

      // Call original onBatch if provided
      if (originalOnBatch) {
        await originalOnBatch(batchDocs, batchIndex, totalLoaded);
      }
    };

    // Load progressively — onBatch fires for each batch and ingests per-batch
    await loadFromPostgresProgressive(resolvedConfig);

    const result: IngestResult = {
      records: allRecords,
      errors: allErrors,
      total: totalDocs,
      elapsed: Date.now() - start,
    };

    return { ...result, introspection };
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

  /** Load files from a git repository and ingest as Blink records */
  async ingestFromGit(config: GitLoadConfig, options: IngestOptions): Promise<IngestResult> {
    const docs = await loadFromGit(config);
    return this.ingest(docs, options);
  }

  /** Load GitHub issues and ingest as Blink records */
  async ingestFromGitHub(config: GitHubLoadConfig, options?: IngestOptions): Promise<IngestResult> {
    const docs = await loadFromGitHubIssues(config);
    const effectiveOptions: IngestOptions = options || { ...GITHUB_DERIVERS, summarize: extractiveSummarize(500) };
    return this.ingest(docs, effectiveOptions);
  }

  /** Evict records that have exceeded their TTL */
  evict(): number {
    return evictStale(this.db);
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
  PostgresLoadConfig, PostgresProgressiveConfig, PostgresIntrospection, PostgresColumnInfo,
  PostgresBatchCallback,
  WebLoadConfig, GitLoadConfig, GitHubLoadConfig, LLMConfig,
} from './types.js';

// Re-export ingestion helpers
export { loadDirectory, extractiveSummarize, extractWikiLinks } from './ingest.js';
export type { ExtractWikiLinksResult, WikiLinkExtractorBlink } from './ingest.js';

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
  GITHUB_DERIVERS,
  githubNamespace, githubTitle, githubTags, githubSources,
  WIKI_DERIVERS,
  wikiClassify, wikiNamespace, wikiTitle, wikiTags, wikiSources,
} from './ingest.js';

// Re-export adapter functions
export { loadFromPostgres, loadFromPostgresProgressive, loadFromUrls, loadFromGit, loadFromGitHubIssues } from './adapters.js';

// Re-export adapter utilities
export { stripHtml, parseUrl, introspectPostgresTable, pickTextColumn } from './adapters.js';

// Re-export LLM helpers
export { llmSummarize, llmClassify } from './llm.js';
