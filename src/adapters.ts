import { execFile } from 'child_process';
import { promisify } from 'util';
import { extname, basename } from 'path';
import type { IngestDocument, Source, PostgresLoadConfig, PostgresProgressiveConfig, PostgresIntrospection, PostgresColumnInfo, WebLoadConfig, GitLoadConfig, GitHubLoadConfig } from './types.js';
import { validatePostgresWhere } from './validation.js';

// ─── HTML text extraction helper ─────────────────────────────

export function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── URL parsing helper ─────────────────────────────────────

export function parseUrl(url: string): { hostname: string; pathname: string; lastSegment: string } {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const segments = pathname.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1] || '';
    return { hostname: parsed.hostname, pathname, lastSegment };
  } catch {
    return { hostname: 'unknown', pathname: '/', lastSegment: '' };
  }
}

/** Extract a title from an HTML <title> tag, falling back to the last URL path segment. */
function extractTitle(html: string, url: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (match && match[1]) {
    return match[1].replace(/\s+/g, ' ').trim();
  }
  const { lastSegment } = parseUrl(url);
  return lastSegment || url;
}

// ─── PostgreSQL adapter ──────────────────────────────────────

function parseDatabaseFromConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const db = url.pathname.replace(/^\//, '');
    return db || 'unknown';
  } catch {
    // Try regex fallback for non-URL formats
    const match = connectionString.match(/(?:database|dbname)\s*=\s*(\S+)/i);
    return match ? match[1] : 'unknown';
  }
}

/** Dynamically import the pg module (optional peer dependency). */
async function importPg(): Promise<any> {
  try {
    const moduleName = 'pg';
    // @ts-ignore — dynamic optional peer dependency
    return await import(/* @vite-ignore */ moduleName);
  } catch {
    throw new Error('pg package required: npm install pg');
  }
}

/** Sanitize connection string by removing password to prevent credential leaks in metadata. */
function sanitizeConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    // Key=value format: mask password values
    return connectionString.replace(/(password\s*=\s*)\S+/i, '$1***');
  }
}

export async function loadFromPostgres(config: PostgresLoadConfig): Promise<IngestDocument[]> {
  const pg = await importPg();
  const Pool = pg.default?.Pool || pg.Pool;
  const pool = new Pool({ connectionString: config.connectionString });

  try {
    const result = await pool.query(config.query);
    const rows: any[] = result.rows;

    if (rows.length === 0) return [];

    const columns = Object.keys(rows[0]);
    const idCol = config.idColumn || columns[0];
    const database = parseDatabaseFromConnectionString(config.connectionString);

    return rows.map((row: any) => {
      const id = String(row[idCol]);
      const text = String(row[config.textColumn] ?? '');

      const metadata: Record<string, unknown> = {
        table: config.table || 'unknown',
        schema: config.schema || 'public',
        database,
        row_id: id,
        connection_string: sanitizeConnectionString(config.connectionString),
      };

      // Add metadata columns
      if (config.metadataColumns) {
        for (const col of config.metadataColumns) {
          if (row[col] !== undefined) {
            metadata[col] = row[col];
          }
        }
      }

      // Add title column to metadata if present
      if (config.titleColumn && row[config.titleColumn] !== undefined) {
        metadata.title = String(row[config.titleColumn]);
      }

      return { id, text, metadata };
    });
  } finally {
    await pool.end();
  }
}

// ─── PostgreSQL introspection ────────────────────────────────

/** PostgreSQL text-like types, ordered by preference for auto-detection. */
const PG_TEXT_TYPES = new Set([
  'text', 'character varying', 'varchar', 'char', 'character',
  'citext', 'name', 'xml', 'json', 'jsonb',
]);

/** Introspect a PostgreSQL table to discover columns, primary key, and row count. */
export async function introspectPostgresTable(
  connectionString: string,
  table: string,
  schema: string = 'public',
): Promise<PostgresIntrospection> {
  const pg = await importPg();
  const Pool = pg.default?.Pool || pg.Pool;
  const pool = new Pool({ connectionString });

  try {
    // 1. Get column metadata from information_schema
    const colResult = await pool.query(
      `SELECT column_name, data_type, is_nullable, character_maximum_length, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       ORDER BY ordinal_position`,
      [schema, table],
    );

    const columns: PostgresColumnInfo[] = colResult.rows.map((row: any) => ({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === 'YES',
      maxLength: row.character_maximum_length != null ? Number(row.character_maximum_length) : null,
      ordinalPosition: Number(row.ordinal_position),
    }));

    if (columns.length === 0) {
      throw new Error(`Table "${schema}"."${table}" not found or has no columns`);
    }

    // 2. Detect primary key
    const pkResult = await pool.query(
      `SELECT kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
       WHERE tc.constraint_type = 'PRIMARY KEY'
         AND tc.table_schema = $1
         AND tc.table_name = $2
       ORDER BY kcu.ordinal_position
       LIMIT 1`,
      [schema, table],
    );
    const primaryKey: string | null = pkResult.rows.length > 0 ? pkResult.rows[0].column_name : null;

    // 3. Get approximate row count (fast) with exact fallback
    let rowCount = 0;
    const statsResult = await pool.query(
      `SELECT n_live_tup FROM pg_stat_user_tables
       WHERE schemaname = $1 AND relname = $2`,
      [schema, table],
    );
    if (statsResult.rows.length > 0 && Number(statsResult.rows[0].n_live_tup) > 0) {
      rowCount = Number(statsResult.rows[0].n_live_tup);
    } else {
      // Fallback to exact count (slower but reliable for small tables or freshly created ones)
      const countResult = await pool.query(`SELECT COUNT(*) AS cnt FROM "${schema}"."${table}"`);
      rowCount = Number(countResult.rows[0].cnt);
    }

    const database = parseDatabaseFromConnectionString(connectionString);

    return { table, schema, database, columns, primaryKey, rowCount };
  } finally {
    await pool.end();
  }
}

/** Pick the best text column from introspection results. Prefers text/varchar with longest max length. */
export function pickTextColumn(introspection: PostgresIntrospection): string | null {
  const textCols = introspection.columns.filter(c => PG_TEXT_TYPES.has(c.dataType));
  if (textCols.length === 0) return null;

  // Prefer 'text' type (unlimited), then longest varchar, then first text-like
  const textType = textCols.find(c => c.dataType === 'text');
  if (textType) return textType.name;

  // Sort by maxLength descending (null = unlimited, treat as very large)
  const sorted = [...textCols].sort((a, b) => {
    const aLen = a.maxLength ?? Number.MAX_SAFE_INTEGER;
    const bLen = b.maxLength ?? Number.MAX_SAFE_INTEGER;
    return bLen - aLen;
  });
  return sorted[0].name;
}

// ─── Progressive PostgreSQL loading ─────────────────────────

/** Convert rows to IngestDocuments using the same logic as loadFromPostgres. */
function rowsToDocuments(
  rows: any[],
  config: {
    connectionString: string;
    textColumn: string;
    idColumn: string;
    titleColumn?: string;
    metadataColumns?: string[];
    table: string;
    schema: string;
  },
): IngestDocument[] {
  const database = parseDatabaseFromConnectionString(config.connectionString);

  return rows.map((row: any) => {
    const id = String(row[config.idColumn]);
    const text = String(row[config.textColumn] ?? '');

    const metadata: Record<string, unknown> = {
      table: config.table,
      schema: config.schema,
      database,
      row_id: id,
      connection_string: sanitizeConnectionString(config.connectionString),
    };

    if (config.metadataColumns) {
      for (const col of config.metadataColumns) {
        if (row[col] !== undefined) {
          metadata[col] = row[col];
        }
      }
    }

    if (config.titleColumn && row[config.titleColumn] !== undefined) {
      metadata.title = String(row[config.titleColumn]);
    }

    return { id, text, metadata };
  });
}

/** Load documents from PostgreSQL in batches using LIMIT/OFFSET pagination. */
export async function loadFromPostgresProgressive(
  config: PostgresProgressiveConfig,
): Promise<IngestDocument[]> {
  const pg = await importPg();
  const Pool = pg.default?.Pool || pg.Pool;
  const pool = new Pool({ connectionString: config.connectionString });

  const schema = config.schema || 'public';
  const table = config.table;
  const batchSize = config.batchSize;
  const orderDirection = config.orderDirection || 'asc';
  const maxRows = config.maxRows ?? Infinity;
  let currentOffset = config.offset ?? 0;

  // Auto-detect columns if needed
  let textColumn = config.textColumn;
  let idColumn = config.idColumn;
  let orderBy = config.orderBy;

  if (!textColumn || !idColumn || !orderBy) {
    // We need introspection — use a separate pool to not conflict
    const introspection = await introspectPostgresTable(config.connectionString, table, schema);

    if (!textColumn) {
      const picked = pickTextColumn(introspection);
      if (!picked) throw new Error(`No text column found in "${schema}"."${table}". Specify textColumn explicitly.`);
      textColumn = picked;
    }

    if (!idColumn) {
      idColumn = introspection.primaryKey || introspection.columns[0].name;
    }

    if (!orderBy) {
      orderBy = introspection.primaryKey || introspection.columns[0].name;
    }
  }

  // Validate WHERE clause for SQL injection before building queries
  if (config.where) {
    validatePostgresWhere(config.where);
  }

  const allDocs: IngestDocument[] = [];

  try {
    let batchIndex = 0;

    while (allDocs.length < maxRows) {
      const limit = Math.min(batchSize, maxRows - allDocs.length);
      const whereClause = config.where ? `WHERE ${config.where}` : '';
      const query = `SELECT * FROM "${schema}"."${table}" ${whereClause} ORDER BY "${orderBy}" ${orderDirection} LIMIT ${limit} OFFSET ${currentOffset}`;

      const result = await pool.query(query);
      const rows: any[] = result.rows;

      if (rows.length === 0) break;

      const batchDocs = rowsToDocuments(rows, {
        connectionString: config.connectionString,
        textColumn,
        idColumn,
        titleColumn: config.titleColumn,
        metadataColumns: config.metadataColumns,
        table,
        schema,
      });

      if (config.onBatch) {
        await config.onBatch(batchDocs, batchIndex, allDocs.length + batchDocs.length);
      }

      allDocs.push(...batchDocs);
      currentOffset += rows.length;
      batchIndex++;

      // If we got fewer rows than requested, we've exhausted the table
      if (rows.length < limit) break;
    }

    return allDocs;
  } finally {
    await pool.end();
  }
}

// ─── Web URL adapter ─────────────────────────────────────────

export async function loadFromUrls(
  urls: string[],
  options?: Omit<WebLoadConfig, 'urls'>,
): Promise<IngestDocument[]> {
  const concurrency = options?.concurrency ?? 3;
  const timeout = options?.timeout ?? 10_000;
  const extractText = options?.extractText || undefined;

  const docs: IngestDocument[] = [];

  // Process in batches
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (url) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        try {
          const response = await fetch(url, { signal: controller.signal });
          clearTimeout(timer);

          const contentType = response.headers.get('content-type') || '';
          const body = await response.text();
          const { hostname, lastSegment } = parseUrl(url);

          let text: string;
          if (extractText) {
            text = extractText(body, url);
          } else if (contentType.includes('text/html')) {
            text = stripHtml(body);
          } else {
            text = body;
          }

          const title = contentType.includes('text/html')
            ? extractTitle(body, url)
            : lastSegment || url;

          const doc: IngestDocument = {
            id: url,
            text,
            metadata: {
              url,
              domain: hostname,
              title,
              status_code: response.status,
              content_type: contentType,
              file_name: lastSegment || hostname,
              file_path: url,
            },
          };

          return doc;
        } catch (err) {
          clearTimeout(timer);
          // Log warning but don't throw — skip failed fetches
          console.warn(`[blink] Failed to fetch ${url}: ${err instanceof Error ? err.message : String(err)}`);
          return null;
        }
      }),
    );

    for (const result of settled) {
      if (result.status === 'fulfilled' && result.value !== null) {
        docs.push(result.value);
      }
    }
  }

  return docs;
}

// ─── Git repository adapter ──────────────────────────────────

const execFileAsync = promisify(execFile);

const GIT_DEFAULT_EXCLUDES = ['node_modules/**', '.git/**', 'dist/**', '*.lock', 'package-lock.json'];
const GIT_TEXT_EXTENSIONS = new Set([
  '.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.csv', '.xml', '.html', '.css',
  '.sh', '.bash', '.zsh', '.sql', '.graphql', '.prisma', '.env.example',
]);

async function gitExec(cwd: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 });
    return stdout.trim();
  } catch (err: any) {
    if (err.stderr?.includes('not a git repository')) {
      throw new Error(`Not a git repository: ${cwd}`);
    }
    throw err;
  }
}

function matchesGlob(filePath: string, pattern: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${regex}$`).test(filePath);
}

function shouldIncludeFile(filePath: string, include?: string[], exclude?: string[]): boolean {
  const excludePatterns = exclude || GIT_DEFAULT_EXCLUDES;
  for (const pattern of excludePatterns) {
    if (matchesGlob(filePath, pattern)) return false;
  }

  if (include && include.length > 0) {
    return include.some(pattern => matchesGlob(filePath, pattern));
  }

  // Default: include files with known text extensions
  const ext = extname(filePath).toLowerCase();
  return GIT_TEXT_EXTENSIONS.has(ext);
}

export async function loadFromGit(config: GitLoadConfig): Promise<IngestDocument[]> {
  const ref = config.ref || 'HEAD';
  const repoPath = config.repoPath;
  const maxFileSize = config.maxFileSize ?? 100_000;

  // Get commit SHA
  const commitSha = await gitExec(repoPath, ['rev-parse', ref]);

  // List all files in the tree
  const fileListRaw = await gitExec(repoPath, ['ls-tree', '-r', '--name-only', ref]);
  const allFiles = fileListRaw.split('\n').filter(Boolean);

  // Filter by include/exclude
  const filtered = allFiles.filter(f => shouldIncludeFile(f, config.include, config.exclude));

  const docs: IngestDocument[] = [];

  for (const filePath of filtered) {
    try {
      // Check file size
      const sizeStr = await gitExec(repoPath, ['cat-file', '-s', `${ref}:${filePath}`]);
      const size = parseInt(sizeStr, 10);
      if (!Number.isFinite(size) || size > maxFileSize) continue;

      // Read file content
      const content = await gitExec(repoPath, ['show', `${ref}:${filePath}`]);

      docs.push({
        id: `${commitSha.slice(0, 7)}:${filePath}`,
        text: content,
        metadata: {
          repo: repoPath,
          ref,
          file_path: filePath,
          file_name: basename(filePath),
          file_type: extname(filePath),
          commit_sha: commitSha,
        },
      });
    } catch {
      // Skip files that can't be read (binary, etc.)
      continue;
    }
  }

  return docs;
}

// ─── GitHub Issues adapter ────────────────────────────────────

export async function loadFromGitHubIssues(config: GitHubLoadConfig): Promise<IngestDocument[]> {
  const token = config.token || process.env.GITHUB_TOKEN;
  const perPage = Math.min(config.perPage || 100, 100);
  const maxPages = config.maxPages || 10;
  const state = config.state || 'all';
  const [owner, repo] = config.repo.split('/');

  if (!owner || !repo) throw new Error('repo must be in "owner/repo" format');

  const docs: IngestDocument[] = [];
  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'blink-query',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  for (let page = 1; page <= maxPages; page++) {
    const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
    url.searchParams.set('state', state);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    if (config.labels?.length) {
      url.searchParams.set('labels', config.labels.join(','));
    }

    const response = await fetch(url.toString(), { headers });
    if (!response.ok) {
      throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }

    const issues = await response.json() as any[];
    if (issues.length === 0) break;

    for (const issue of issues) {
      // Skip PRs (GitHub API returns PRs in the issues endpoint)
      if (issue.pull_request) continue;
      // Skip issues with no body
      if (!issue.body || issue.body.trim().length === 0) continue;

      docs.push({
        id: String(issue.number),
        text: issue.body,
        metadata: {
          repo: config.repo,
          issue_number: issue.number,
          title: issue.title,
          state: issue.state,
          labels: (issue.labels || []).map((l: any) => l.name),
          created_at: issue.created_at,
          updated_at: issue.updated_at,
          html_url: issue.html_url,
          user: issue.user?.login,
          is_pull_request: false,
        },
      });
    }

    if (config.onPage) config.onPage(page, docs.length);
    if (issues.length < perPage) break; // Last page
  }

  return docs;
}
