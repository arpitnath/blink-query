import type { IngestDocument, Source, PostgresLoadConfig, WebLoadConfig } from './types.js';

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
  let pg: any;
  try {
    // Dynamic import — pg is an optional peer dependency.
    // Variable module name prevents TypeScript from resolving at type-check time.
    const moduleName = 'pg';
    // @ts-ignore — dynamic optional peer dependency
    pg = await import(/* @vite-ignore */ moduleName);
  } catch {
    throw new Error('pg package required: npm install pg');
  }

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
