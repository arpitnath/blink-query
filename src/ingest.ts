import { extname, basename, dirname } from 'path';
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
    content: type === 'SOURCE' ? { original_id: doc.id, source_metadata: doc.metadata } : undefined,
    tags,
    ttl: options.ttl,
    sources,
  };
}

// ─── Batch processing ───────────────────────────────────────

export async function processDocuments(
  blink: { saveMany(inputs: SaveInput[]): BlinkRecord[] },
  docs: IngestDocument[],
  options: IngestOptions,
): Promise<IngestResult> {
  const start = Date.now();
  const concurrency = options.concurrency || 5;
  const results: SaveInput[] = [];
  const errors: Array<{ document: IngestDocument; error: Error }> = [];

  for (let i = 0; i < docs.length; i += concurrency) {
    const batch = docs.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(doc => documentToSaveInput(doc, options)),
    );

    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        results.push(result.value);
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
  }

  const records = results.length > 0 ? blink.saveMany(results) : [];

  return { records, errors, total: docs.length, elapsed: Date.now() - start };
}

// ─── Directory loading ──────────────────────────────────────

export async function loadDirectory(
  dirPath: string,
  options?: { recursive?: boolean; extensions?: string[] },
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
      metadata: (doc.metadata || {}) as Record<string, unknown>,
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
]);

async function loadDirectoryBasic(
  dirPath: string,
  options?: { recursive?: boolean; extensions?: string[] },
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
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && options?.recursive !== false) {
        await walk(fullPath);
      } else if (entry.isFile() && allowedExts.has(ext(entry.name).toLowerCase())) {
        try {
          const content = await readFile(fullPath, 'utf-8');
          const stats = await stat(fullPath);
          const relPath = relative(basePath, fullPath);
          docs.push({
            id: randomUUID(),
            text: content,
            metadata: {
              file_path: relPath,
              file_name: entry.name,
              file_type: ext(entry.name),
              file_size: stats.size,
            },
          });
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
