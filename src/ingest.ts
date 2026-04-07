import { extname, basename, dirname } from 'path';
import { slug } from './store.js';
import type {
  IngestDocument,
  IngestOptions,
  IngestResult,
  SaveInput,
  BlinkRecord,
  RecordType,
  Source,
  SummarizeCallback,
  DeriveNamespaceCallback,
  DeriveTitleCallback,
  DeriveTagsCallback,
  BuildSourcesCallback,
} from './types.js';

// ─── Filesystem derivers (default for file-based ingestion) ─

export function filesystemNamespace(
  metadata: Record<string, unknown>,
): string {
  const filePath = (metadata.file_path as string) || 'unknown';
  const dir = dirname(filePath).replace(/^\.?\/?/, '').replace(/\\/g, '/');
  return dir || 'ingested';
}

export function filesystemTitle(
  metadata: Record<string, unknown>,
): string {
  const fileName = (metadata.file_name as string) || 'untitled';
  const ext = extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

export function filesystemTags(
  metadata: Record<string, unknown>,
  extraTags?: string[],
): string[] {
  const tags: string[] = [];

  const fileType = metadata.file_type as string | undefined;
  const filePath = metadata.file_path as string | undefined;
  const fileName = metadata.file_name as string | undefined;

  if (fileType) {
    tags.push(fileType.replace(/^\./, ''));
  } else if (fileName) {
    const ext = extname(fileName).replace(/^\./, '');
    if (ext) tags.push(ext);
  }

  if (filePath) {
    const parts = dirname(filePath).split('/').filter(Boolean).slice(0, 2);
    tags.push(...parts);
  }

  if (extraTags) tags.push(...extraTags);

  return [...new Set(tags.map(t => t.toLowerCase()))];
}

export function filesystemSources(
  metadata: Record<string, unknown>,
): Source[] {
  const filePath = (metadata.file_path as string) || undefined;
  return filePath
    ? [{ type: 'file', file_path: filePath, last_fetched: new Date().toISOString() }]
    : [];
}

/** Preset derivers for filesystem-based ingestion (the default). */
export const FILESYSTEM_DERIVERS = {
  deriveNamespace: filesystemNamespace,
  deriveTitle: filesystemTitle,
  deriveTags: filesystemTags,
  buildSources: filesystemSources,
} as const;

// ─── Postgres derivers (for PostgreSQL row data) ────────────

export function postgresNamespace(
  metadata: Record<string, unknown>,
): string {
  const table = (metadata.table as string) || 'unknown';
  const schema = metadata.schema as string | undefined;
  const database = metadata.database as string | undefined;
  if (schema) return `${schema}/${table}`;
  if (database) return `${database}/${table}`;
  return table;
}

export function postgresTitle(
  metadata: Record<string, unknown>,
): string {
  if (metadata.title && typeof metadata.title === 'string' && metadata.title.length > 0) return metadata.title;
  const table = (metadata.table as string) || 'unknown';
  const rowId = metadata.row_id;
  if (rowId !== undefined && rowId !== null && rowId !== '') {
    return `${table}/${rowId}`;
  }
  return `${table}/unknown`;
}

export function postgresTags(
  metadata: Record<string, unknown>,
  extraTags?: string[],
): string[] {
  const tags: string[] = ['postgres'];
  const table = metadata.table as string | undefined;
  const schema = metadata.schema as string | undefined;
  if (table) tags.push(table);
  if (schema) tags.push(schema);
  if (extraTags) tags.push(...extraTags);
  return [...new Set(tags.map(t => t.toLowerCase()))];
}

export function postgresSources(
  metadata: Record<string, unknown>,
): Source[] {
  const table = (metadata.table as string) || undefined;
  return [{
    type: 'database',
    table,
    connection_string: (metadata.connection_string as string) || undefined,
    query: (metadata.query as string) || undefined,
  }];
}

/** Preset derivers for PostgreSQL row data. */
export const POSTGRES_DERIVERS = {
  deriveNamespace: postgresNamespace,
  deriveTitle: postgresTitle,
  deriveTags: postgresTags,
  buildSources: postgresSources,
} as const;

// ─── Web derivers (for web-scraped content) ─────────────────

export function webNamespace(
  metadata: Record<string, unknown>,
): string {
  const url = metadata.url as string | undefined;
  if (!url) return 'web/unknown';
  try {
    const hostname = new URL(url).hostname;
    return `web/${hostname.replace(/\./g, '-')}`;
  } catch {
    return 'web/unknown';
  }
}

export function webTitle(
  metadata: Record<string, unknown>,
): string {
  if (metadata.title && typeof metadata.title === 'string' && metadata.title.length > 0) return metadata.title;
  const url = metadata.url as string | undefined;
  if (url) {
    try {
      const pathname = new URL(url).pathname;
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length > 0) return segments[segments.length - 1];
    } catch {
      // fall through
    }
  }
  return 'page';
}

export function webTags(
  metadata: Record<string, unknown>,
  extraTags?: string[],
): string[] {
  const tags: string[] = ['web'];
  const domain = metadata.domain as string | undefined;
  if (domain) tags.push(domain);
  const contentType = metadata.content_type as string | undefined;
  if (contentType) {
    // Extract short form: "text/html" → "html", "application/json" → "json"
    const short = contentType.split('/').pop()?.split(';')[0]?.trim();
    if (short) tags.push(short);
  }
  if (extraTags) tags.push(...extraTags);
  return [...new Set(tags.map(t => t.toLowerCase()))];
}

export function webSources(
  metadata: Record<string, unknown>,
): Source[] {
  const url = (metadata.url as string) || undefined;
  return [{
    type: 'web',
    url,
    endpoint: url,
    last_fetched: new Date().toISOString(),
  }];
}

/** Preset derivers for web-scraped content. */
export const WEB_DERIVERS = {
  deriveNamespace: webNamespace,
  deriveTitle: webTitle,
  deriveTags: webTags,
  buildSources: webSources,
} as const;

// ─── Git derivers (for git repository data) ─────────────────

export function gitNamespace(
  metadata: Record<string, unknown>,
): string {
  const repo = (metadata.repo as string) || 'unknown';
  const segments = repo.replace(/\\/g, '/').split('/').filter(Boolean);
  const repoName = segments[segments.length - 1] || 'unknown';
  return `git/${repoName}`;
}

export function gitTitle(
  metadata: Record<string, unknown>,
): string {
  const filePath = metadata.file_path as string | undefined;
  if (filePath) {
    const ext = extname(filePath);
    return ext ? filePath.slice(0, -ext.length) : filePath;
  }
  const commitSha = metadata.commit_sha as string | undefined;
  if (commitSha) return commitSha.slice(0, 7);
  return (metadata.repo as string) || 'unknown';
}

export function gitTags(
  metadata: Record<string, unknown>,
  extraTags?: string[],
): string[] {
  const tags: string[] = ['git'];
  const ref = metadata.ref as string | undefined;
  if (ref) tags.push(ref);
  const repo = metadata.repo as string | undefined;
  if (repo) {
    const segments = repo.replace(/\\/g, '/').split('/').filter(Boolean);
    const repoName = segments[segments.length - 1];
    if (repoName) tags.push(repoName);
  }
  if (extraTags) tags.push(...extraTags);
  return [...new Set(tags.map(t => t.toLowerCase()))];
}

export function gitSources(
  metadata: Record<string, unknown>,
): Source[] {
  return [{
    type: 'vcs',
    repo: (metadata.repo as string) || undefined,
    ref: (metadata.ref as string) || undefined,
    file_path: (metadata.file_path as string) || undefined,
  }];
}

/** Preset derivers for git repository data. */
export const GIT_DERIVERS = {
  deriveNamespace: gitNamespace,
  deriveTitle: gitTitle,
  deriveTags: gitTags,
  buildSources: gitSources,
} as const;

// ─── GitHub derivers (for GitHub Issues data) ────────────────

export function githubNamespace(metadata: Record<string, unknown>): string {
  const repo = (metadata.repo as string) || 'unknown';
  const labels = metadata.labels as string[] | undefined;
  const firstLabel = labels && labels.length > 0 ? labels[0] : 'unlabeled';
  // Sanitize label for path use
  const safeLabel = firstLabel.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  return `github/${repo}/issues/${safeLabel}`;
}

export function githubTitle(metadata: Record<string, unknown>): string {
  return (metadata.title as string) || `issue-${metadata.issue_number}`;
}

export function githubTags(metadata: Record<string, unknown>, extraTags?: string[]): string[] {
  const tags: string[] = ['github'];
  const labels = metadata.labels as string[] | undefined;
  if (labels) tags.push(...labels);
  const repo = metadata.repo as string | undefined;
  if (repo) tags.push(repo.split('/').pop() || repo);
  const state = metadata.state as string | undefined;
  if (state) tags.push(state);
  if (extraTags) tags.push(...extraTags);
  return [...new Set(tags.map(t => t.toLowerCase()))];
}

export function githubSources(metadata: Record<string, unknown>): Source[] {
  const htmlUrl = metadata.html_url as string | undefined;
  return [{
    type: 'web',
    url: htmlUrl,
    last_fetched: new Date().toISOString(),
  }];
}

/** Preset derivers for GitHub Issues data. */
export const GITHUB_DERIVERS = {
  deriveNamespace: githubNamespace,
  deriveTitle: githubTitle,
  deriveTags: githubTags,
  buildSources: githubSources,
} as const;

// ─── Wiki derivers (for LLM wiki pattern — markdown + wikilinks) ─

/**
 * Rule-based classifier for LLM wiki content.
 *
 * Order of precedence:
 *   1. Frontmatter `type:` field (explicit override)
 *   2. File extension: .json/.yaml/.yml → META
 *   3. Frontmatter `source_url:` (or `url:`) field → SOURCE
 *   4. Markdown file with heading (# ...) → SUMMARY
 *   5. Default fallback → SOURCE
 */
export function wikiClassify(
  text: string,
  metadata: Record<string, unknown>,
): RecordType {
  // 1. Frontmatter explicit type wins
  const fm = metadata.frontmatter as Record<string, unknown> | undefined;
  if (fm && typeof fm.type === 'string') {
    const t = fm.type.toLowerCase();
    if (t === 'source') return 'SOURCE';
    if (t === 'summary') return 'SUMMARY';
    if (t === 'meta') return 'META';
    if (t === 'collection') return 'COLLECTION';
    if (t === 'alias') return 'ALIAS';
  }

  // 2. Structured-data file extensions → META
  const fileName = metadata.file_name as string | undefined;
  const ext = fileName ? extname(fileName).toLowerCase() : '';
  if (ext === '.json' || ext === '.yaml' || ext === '.yml') return 'META';

  // 3. Frontmatter source_url (or url) → external SOURCE
  // Accept both field names — source_url is the wiki convention, url is shorthand.
  const sourceUrl =
    (fm && typeof fm.source_url === 'string' && fm.source_url) ||
    (fm && typeof fm.url === 'string' && fm.url);
  if (sourceUrl) return 'SOURCE';

  // 4. Markdown with at least one heading → SUMMARY
  if (ext === '.md' || ext === '.markdown') {
    if (/^#{1,6}[ \t]+\S/m.test(text)) return 'SUMMARY';
  }

  // 5. Default
  return 'SOURCE';
}

/**
 * Derive a namespace by wiki content shape. Inspects `file_path` subdirectories
 * to route content into stable namespaces:
 *   - entity/<name>/...    → entity/<slug(name)>
 *   - topics/<name>/...    → topics/<slug(name)>
 *   - log/<YYYY-MM-DD>/... → log/<YYYY-MM-DD>
 *   - root-level files     → sources
 *   - other directories    → dirname(file_path) (filesystem fallback)
 *
 * Frontmatter `namespace:` overrides everything.
 */
export function wikiNamespace(metadata: Record<string, unknown>): string {
  // Frontmatter namespace override
  const fm = metadata.frontmatter as Record<string, unknown> | undefined;
  if (fm && typeof fm.namespace === 'string' && fm.namespace.length > 0) {
    return fm.namespace;
  }

  const filePath = metadata.file_path as string | undefined;
  if (!filePath) return 'sources';

  const normalized = filePath.replace(/\\/g, '/').replace(/^\.?\/?/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return 'sources';

  // Drop the filename (last segment)
  const dirs = parts.slice(0, -1);

  // Root-level files → sources
  if (dirs.length === 0) return 'sources';

  // Wiki-specific prefixes
  if (dirs[0] === 'log' && dirs.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(dirs[1])) {
    return `log/${dirs[1]}`;
  }
  if (dirs[0] === 'entity' || dirs[0] === 'topics') {
    return dirs.length >= 2 ? `${dirs[0]}/${slug(dirs[1])}` : dirs[0];
  }

  // Other directories: preserve structure
  return dirs.join('/');
}

/**
 * Derive a title from wiki metadata. Prefers frontmatter `title:` if present,
 * otherwise falls back to the filename without extension.
 */
export function wikiTitle(metadata: Record<string, unknown>): string {
  const fm = metadata.frontmatter as Record<string, unknown> | undefined;
  if (fm && typeof fm.title === 'string' && fm.title.length > 0) return fm.title;

  const fileName = (metadata.file_name as string) || 'untitled';
  const ext = extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

/**
 * Derive tags from wiki metadata. Always includes 'wiki', plus frontmatter
 * tags, file extension, and the top-level directory (entity/topics/log/etc).
 */
export function wikiTags(
  metadata: Record<string, unknown>,
  extraTags?: string[],
): string[] {
  const tags: string[] = ['wiki'];

  // Frontmatter tags
  const fm = metadata.frontmatter as Record<string, unknown> | undefined;
  if (fm && Array.isArray(fm.tags)) {
    for (const t of fm.tags) {
      if (typeof t === 'string') tags.push(t);
    }
  }

  // File extension
  const fileName = metadata.file_name as string | undefined;
  if (fileName) {
    const ext = extname(fileName).replace(/^\./, '');
    if (ext) tags.push(ext);
  }

  // Top-level directory as a tag
  const filePath = metadata.file_path as string | undefined;
  if (filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
    if (parts.length > 1) tags.push(parts[0]);
  }

  if (extraTags) tags.push(...extraTags);
  return [...new Set(tags.map(t => t.toLowerCase()))];
}

/** Build file-based source references for wiki content. */
export function wikiSources(metadata: Record<string, unknown>): Source[] {
  const filePath = (metadata.file_path as string) || undefined;
  return filePath
    ? [{ type: 'file', file_path: filePath, last_fetched: new Date().toISOString() }]
    : [];
}

/**
 * Preset derivers + classifier for the LLM wiki pattern.
 *
 * Unlike the other *_DERIVERS presets, this bundle also includes a
 * rule-based `classify` function, so it can be spread directly into
 * `blink.ingest()` options without needing a separate classifier.
 *
 * @example
 *   await blink.ingestDirectory('./wiki', { ...WIKI_DERIVERS, summarize });
 */
export const WIKI_DERIVERS = {
  classify: wikiClassify,
  deriveNamespace: wikiNamespace,
  deriveTitle: wikiTitle,
  deriveTags: wikiTags,
  buildSources: wikiSources,
} as const;

// ─── Resolve namespace with prefix/override ─────────────────

function resolveNamespace(
  metadata: Record<string, unknown>,
  options: IngestOptions,
): string {
  // Explicit string namespace overrides everything
  if (typeof options.namespace === 'string') return options.namespace;
  // Legacy function form
  if (typeof options.namespace === 'function') return options.namespace(metadata);

  // Use custom deriver or filesystem default
  const deriver = options.deriveNamespace || filesystemNamespace;
  const ns = deriver(metadata);

  return options.namespacePrefix ? `${options.namespacePrefix}/${ns}` : ns;
}

// ─── Document → SaveInput mapping ───────────────────────────

export async function documentToSaveInput(
  doc: IngestDocument,
  options: IngestOptions,
): Promise<SaveInput> {
  const summarize = options.summarize || extractiveSummarize(500);
  const summary = await summarize(doc.text, doc.metadata);
  const type: RecordType = options.classify
    ? await options.classify(doc.text, doc.metadata)
    : 'SOURCE';

  const namespace = resolveNamespace(doc.metadata, options);
  const titleDeriver = options.deriveTitle || filesystemTitle;
  const title = titleDeriver(doc.metadata);
  const tagDeriver = options.deriveTags || filesystemTags;
  const tags = tagDeriver(doc.metadata, options.tags);
  const sourceBuilder = options.buildSources || filesystemSources;
  const sources = sourceBuilder(doc.metadata);

  return {
    namespace,
    title,
    type,
    summary,
    content: deriveContent(type, doc),
    tags,
    ttl: options.ttl,
    sources,
  };
}

/**
 * Derive the structured content field for an ingested record.
 *
 * SOURCE — track original_id and source_metadata so consumers can refetch.
 * META   — pass through frontmatter.content if present, else the full
 *          frontmatter object, so structured wiki entity pages survive
 *          ingestion (the previous behaviour silently dropped this).
 * Other  — no structured content; the summary text carries the value.
 */
function deriveContent(type: RecordType, doc: IngestDocument): unknown | undefined {
  if (type === 'SOURCE') {
    return { original_id: doc.id, source_metadata: doc.metadata };
  }
  if (type === 'META') {
    const fm = doc.metadata?.frontmatter as Record<string, unknown> | undefined;
    if (fm && 'content' in fm && fm.content !== undefined) return fm.content;
    if (fm && Object.keys(fm).length > 0) return fm;
    if (doc.metadata && Object.keys(doc.metadata).length > 0) return doc.metadata;
    return undefined;
  }
  return undefined;
}

// ─── Batch processing ───────────────────────────────────────

export async function processDocuments(
  blink: { saveMany(inputs: SaveInput[]): BlinkRecord[] },
  docs: IngestDocument[],
  options: IngestOptions,
): Promise<IngestResult> {
  const start = Date.now();
  const concurrency = options.concurrency || 5;
  const records: BlinkRecord[] = [];
  const errors: Array<{ document: IngestDocument; error: Error }> = [];

  for (let i = 0; i < docs.length; i += concurrency) {
    const batch = docs.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(doc => documentToSaveInput(doc, options)),
    );

    const batchInputs: SaveInput[] = [];
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        batchInputs.push(result.value);
      } else {
        errors.push({
          document: batch[idx],
          error:
            result.reason instanceof Error
              ? result.reason
              : new Error(String(result.reason)),
        });
      }
    });

    if (batchInputs.length > 0) {
      const saved = blink.saveMany(batchInputs);
      records.push(...saved);
    }

    if (options.onBatchComplete) {
      options.onBatchComplete({
        processed: Math.min(i + batch.length, docs.length),
        total: docs.length,
        batchSize: batchInputs.length,
      });
    }
  }

  return { records, errors, total: docs.length, elapsed: Date.now() - start };
}

// ─── Directory loading ──────────────────────────────────────

export interface LoadDirectoryOptions {
  recursive?: boolean;
  extensions?: string[];
  maxFileSize?: number;
  includeHidden?: boolean;
  onProgress?: (info: { current: number; file: string }) => void;
}

export async function loadDirectory(
  dirPath: string,
  options?: LoadDirectoryOptions,
): Promise<IngestDocument[]> {
  try {
    // Optional peer dependency — only resolved at runtime
    const moduleName = '@llamaindex/readers/directory';
    // @ts-ignore
    const { SimpleDirectoryReader } = await import(/* @vite-ignore */ moduleName);
    const reader = new SimpleDirectoryReader();
    const llamaDocs = await reader.loadData({ directoryPath: dirPath });

    return llamaDocs.map((doc: any) => ({
      id: doc.id_,
      text: typeof doc.getText === 'function' ? doc.getText() : doc.text,
      metadata: {
        ...(doc.metadata || {}),
        loader: 'llamaindex',
      } as Record<string, unknown>,
    }));
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('Cannot find module') ||
        err.message.includes('ERR_MODULE_NOT_FOUND') ||
        err.message.includes('Cannot find package') ||
        err.message.includes('Could not resolve'))
    ) {
      return loadDirectoryBasic(dirPath, options);
    }
    throw err;
  }
}

const DEFAULT_TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv',
  '.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.rb', '.sh', '.bash', '.zsh',
  '.yaml', '.yml', '.toml', '.xml', '.html', '.css', '.sql',
  '.env', '.conf', '.cfg', '.ini', '.log',
  '.vue', '.svelte',                     // Frontend frameworks
  '.scss', '.sass', '.less',             // CSS preprocessors
  '.graphql', '.gql',                    // GraphQL
  '.proto',                              // Protocol Buffers
  '.tf', '.hcl',                         // Terraform
  '.prisma',                             // Prisma
  '.dockerfile',                         // Docker
  '.r',                                  // R language
  '.swift', '.kt', '.kts',               // Swift, Kotlin
  '.lua', '.pl', '.pm',                  // Lua, Perl
  '.ex', '.exs',                         // Elixir
  '.erl', '.hrl',                        // Erlang
  '.zig',                                // Zig
  '.sol',                                // Solidity
  '.cs',                                 // C#
  '.fs',                                 // F#
]);

async function loadDirectoryBasic(
  dirPath: string,
  options?: LoadDirectoryOptions,
): Promise<IngestDocument[]> {
  const { readdir, readFile, stat } = await import('fs/promises');
  const { join, relative, extname: ext } = await import('path');
  const { randomUUID } = await import('crypto');

  const allowedExts = options?.extensions
    ? new Set(options.extensions)
    : DEFAULT_TEXT_EXTENSIONS;

  const docs: IngestDocument[] = [];
  const basePath = dirPath;

  async function walk(dir: string) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // E2: Skip hidden files/directories unless includeHidden is true
      if (entry.name.startsWith('.') && !options?.includeHidden) continue;

      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && options?.recursive !== false) {
        await walk(fullPath);
      } else if (entry.isFile() && allowedExts.has(ext(entry.name).toLowerCase())) {
        try {
          // E1: Check file size before reading
          const stats = await stat(fullPath);
          if (stats.size > (options?.maxFileSize ?? 1_048_576)) continue;

          const content = await readFile(fullPath, 'utf-8');

          // E3: Skip empty files
          if (content.trim().length === 0) continue;

          const relPath = relative(basePath, fullPath);
          docs.push({
            id: randomUUID(),
            text: content,
            metadata: {
              file_path: relPath,
              file_name: entry.name,
              file_type: ext(entry.name),
              file_size: stats.size,
              loader: 'basic',  // E6: Loader metadata
            },
          });

          // E5: Progress callback
          if (options?.onProgress) {
            options.onProgress({ current: docs.length, file: relPath });
          }
        } catch {
          // Skip files that can't be read as UTF-8
          continue;
        }
      }
    }
  }

  await walk(dirPath);
  return docs;
}

// ─── Default summarizer ─────────────────────────────────────

export function extractiveSummarize(maxLength = 500): SummarizeCallback {
  return (text: string) => {
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (cleaned.length <= maxLength) return cleaned;
    return cleaned.slice(0, maxLength).replace(/\s\S*$/, '') + '...';
  };
}
