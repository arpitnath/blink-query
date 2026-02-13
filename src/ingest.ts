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
