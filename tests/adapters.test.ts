import { describe, it, expect, vi } from 'vitest';
import { stripHtml, parseUrl, loadFromPostgres, loadFromUrls, pickTextColumn } from '../src/adapters.js';
import type { PostgresLoadConfig, PostgresProgressiveConfig, PostgresIntrospection, PostgresColumnInfo, WebLoadConfig } from '../src/types.js';

// ─── stripHtml ───────────────────────────────────────────────

describe('stripHtml', () => {
  it('strips basic HTML tags', () => {
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('removes script tags and their content', () => {
    const html = '<p>Before</p><script>alert("xss")</script><p>After</p>';
    expect(stripHtml(html)).toBe('Before After');
  });

  it('removes style tags and their content', () => {
    const html = '<style>.foo { color: red; }</style><p>Content</p>';
    expect(stripHtml(html)).toBe('Content');
  });

  it('removes nested script content', () => {
    const html = '<script type="text/javascript">var x = 1; if (x < 2) { console.log("hi"); }</script><div>Real content</div>';
    expect(stripHtml(html)).toBe('Real content');
  });

  it('collapses whitespace', () => {
    const html = '<p>Hello</p>   \n\n  <p>World</p>';
    expect(stripHtml(html)).toBe('Hello World');
  });

  it('handles empty string', () => {
    expect(stripHtml('')).toBe('');
  });

  it('handles plain text without tags', () => {
    expect(stripHtml('Just plain text')).toBe('Just plain text');
  });

  it('handles self-closing tags', () => {
    expect(stripHtml('Line one<br/>Line two<hr/>')).toBe('Line one Line two');
  });
});

// ─── parseUrl ────────────────────────────────────────────────

describe('parseUrl', () => {
  it('parses a standard URL', () => {
    const result = parseUrl('https://example.com/docs/api/overview.html');
    expect(result.hostname).toBe('example.com');
    expect(result.pathname).toBe('/docs/api/overview.html');
    expect(result.lastSegment).toBe('overview.html');
  });

  it('parses URL with no path', () => {
    const result = parseUrl('https://example.com');
    expect(result.hostname).toBe('example.com');
    expect(result.lastSegment).toBe('');
  });

  it('parses URL with trailing slash', () => {
    const result = parseUrl('https://example.com/docs/');
    expect(result.hostname).toBe('example.com');
    expect(result.lastSegment).toBe('docs');
  });

  it('handles invalid URL gracefully', () => {
    const result = parseUrl('not-a-url');
    expect(result.hostname).toBe('unknown');
    expect(result.pathname).toBe('/');
    expect(result.lastSegment).toBe('');
  });
});

// ─── loadFromPostgres ────────────────────────────────────────

describe('loadFromPostgres', () => {
  it('rejects with connection error for invalid host', async () => {
    const config: PostgresLoadConfig = {
      connectionString: 'postgresql://localhost:59999/nonexistent_db',
      query: 'SELECT * FROM docs',
      textColumn: 'content',
    };

    await expect(loadFromPostgres(config)).rejects.toThrow();
  });
});

// ─── loadFromUrls ────────────────────────────────────────────

describe('loadFromUrls', () => {
  it('returns empty array for empty URL list', async () => {
    const docs = await loadFromUrls([]);
    expect(docs).toEqual([]);
  });

  it('skips URLs that fail to fetch', async () => {
    // Use an invalid URL that will definitely fail
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const docs = await loadFromUrls(['http://localhost:1/nonexistent'], { timeout: 500 });
    expect(docs).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it('uses custom extractText function when provided', async () => {
    // Mock global fetch
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: () => Promise.resolve('<html><body><p>Hello</p></body></html>'),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const docs = await loadFromUrls(
        ['https://example.com/page'],
        { extractText: (html) => `CUSTOM: ${html.length} chars` },
      );
      expect(docs).toHaveLength(1);
      expect(docs[0].text).toMatch(/^CUSTOM: \d+ chars$/);
      expect(docs[0].id).toBe('https://example.com/page');
      expect(docs[0].metadata.domain).toBe('example.com');
      expect(docs[0].metadata.status_code).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('strips HTML for text/html content type', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: () => Promise.resolve('<html><head><title>Test Page</title></head><body><p>Hello world</p></body></html>'),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const docs = await loadFromUrls(['https://example.com/test']);
      expect(docs).toHaveLength(1);
      expect(docs[0].text).toBe('Test Page Hello world');
      expect(docs[0].metadata.title).toBe('Test Page');
      expect(docs[0].metadata.content_type).toBe('text/html; charset=utf-8');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns raw text for non-HTML content', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: () => Promise.resolve('{"key": "value"}'),
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const docs = await loadFromUrls(['https://api.example.com/data.json']);
      expect(docs).toHaveLength(1);
      expect(docs[0].text).toBe('{"key": "value"}');
      expect(docs[0].metadata.file_name).toBe('data.json');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('respects concurrency setting', async () => {
    let concurrentCalls = 0;
    let maxConcurrent = 0;

    const mockFetch = vi.fn().mockImplementation(async () => {
      concurrentCalls++;
      maxConcurrent = Math.max(maxConcurrent, concurrentCalls);
      await new Promise((r) => setTimeout(r, 50));
      concurrentCalls--;
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: () => Promise.resolve('content'),
      };
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;

    try {
      const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/page${i}`);
      await loadFromUrls(urls, { concurrency: 2 });
      expect(maxConcurrent).toBeLessThanOrEqual(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ─── Type compilation checks ─────────────────────────────────

describe('adapter type interfaces', () => {
  it('PostgresLoadConfig compiles with all fields', () => {
    const config: PostgresLoadConfig = {
      connectionString: 'postgresql://user:pass@localhost:5432/db',
      query: 'SELECT id, content, title FROM articles',
      textColumn: 'content',
      idColumn: 'id',
      titleColumn: 'title',
      metadataColumns: ['author', 'created_at'],
      table: 'articles',
      schema: 'public',
    };
    expect(config.connectionString).toBeTruthy();
    expect(config.textColumn).toBe('content');
  });

  it('PostgresLoadConfig compiles with minimal fields', () => {
    const config: PostgresLoadConfig = {
      connectionString: 'postgresql://localhost/db',
      query: 'SELECT * FROM docs',
      textColumn: 'body',
    };
    expect(config.idColumn).toBeUndefined();
    expect(config.metadataColumns).toBeUndefined();
  });

  it('WebLoadConfig compiles with all fields', () => {
    const config: WebLoadConfig = {
      urls: ['https://example.com'],
      concurrency: 5,
      timeout: 15000,
      extractText: (html) => html.slice(0, 100),
    };
    expect(config.urls).toHaveLength(1);
    expect(config.concurrency).toBe(5);
  });

  it('WebLoadConfig compiles with minimal fields', () => {
    const config: WebLoadConfig = {
      urls: ['https://example.com/a', 'https://example.com/b'],
    };
    expect(config.concurrency).toBeUndefined();
    expect(config.timeout).toBeUndefined();
  });

  it('PostgresProgressiveConfig compiles with all fields', () => {
    const config: PostgresProgressiveConfig = {
      connectionString: 'postgresql://user:pass@localhost:5432/db',
      table: 'articles',
      schema: 'public',
      textColumn: 'content',
      idColumn: 'id',
      titleColumn: 'title',
      metadataColumns: ['author', 'created_at'],
      batchSize: 100,
      orderBy: 'id',
      orderDirection: 'asc',
      offset: 0,
      maxRows: 1000,
      where: 'status = true',
      onBatch: (docs, idx, total) => {
        // callback signature check
      },
    };
    expect(config.connectionString).toBeTruthy();
    expect(config.batchSize).toBe(100);
    expect(config.orderDirection).toBe('asc');
  });

  it('PostgresProgressiveConfig compiles with minimal fields', () => {
    const config: PostgresProgressiveConfig = {
      connectionString: 'postgresql://localhost/db',
      table: 'docs',
      batchSize: 50,
    };
    expect(config.textColumn).toBeUndefined();
    expect(config.idColumn).toBeUndefined();
    expect(config.orderBy).toBeUndefined();
    expect(config.maxRows).toBeUndefined();
    expect(config.onBatch).toBeUndefined();
  });

  it('PostgresIntrospection type shape validates', () => {
    const introspection: PostgresIntrospection = {
      table: 'articles',
      schema: 'public',
      database: 'mydb',
      columns: [
        { name: 'id', dataType: 'integer', nullable: false, maxLength: null, ordinalPosition: 1 },
        { name: 'content', dataType: 'text', nullable: true, maxLength: null, ordinalPosition: 2 },
        { name: 'title', dataType: 'character varying', nullable: false, maxLength: 255, ordinalPosition: 3 },
      ],
      primaryKey: 'id',
      rowCount: 42,
    };
    expect(introspection.columns).toHaveLength(3);
    expect(introspection.primaryKey).toBe('id');
    expect(introspection.rowCount).toBe(42);
  });

  it('PostgresColumnInfo type shape validates', () => {
    const col: PostgresColumnInfo = {
      name: 'description',
      dataType: 'text',
      nullable: true,
      maxLength: null,
      ordinalPosition: 4,
    };
    expect(col.name).toBe('description');
    expect(col.nullable).toBe(true);
  });
});

// ─── pickTextColumn ──────────────────────────────────────────

describe('pickTextColumn', () => {
  function makeIntrospection(columns: PostgresColumnInfo[]): PostgresIntrospection {
    return {
      table: 'test',
      schema: 'public',
      database: 'testdb',
      columns,
      primaryKey: 'id',
      rowCount: 10,
    };
  }

  it('prefers text type over varchar', () => {
    const result = pickTextColumn(makeIntrospection([
      { name: 'id', dataType: 'integer', nullable: false, maxLength: null, ordinalPosition: 1 },
      { name: 'short_name', dataType: 'character varying', nullable: false, maxLength: 50, ordinalPosition: 2 },
      { name: 'body', dataType: 'text', nullable: true, maxLength: null, ordinalPosition: 3 },
    ]));
    expect(result).toBe('body');
  });

  it('picks longest varchar when no text type present', () => {
    const result = pickTextColumn(makeIntrospection([
      { name: 'id', dataType: 'integer', nullable: false, maxLength: null, ordinalPosition: 1 },
      { name: 'short_name', dataType: 'character varying', nullable: false, maxLength: 50, ordinalPosition: 2 },
      { name: 'description', dataType: 'character varying', nullable: true, maxLength: 500, ordinalPosition: 3 },
    ]));
    expect(result).toBe('description');
  });

  it('returns null when no text-like columns exist', () => {
    const result = pickTextColumn(makeIntrospection([
      { name: 'id', dataType: 'integer', nullable: false, maxLength: null, ordinalPosition: 1 },
      { name: 'count', dataType: 'bigint', nullable: false, maxLength: null, ordinalPosition: 2 },
      { name: 'active', dataType: 'boolean', nullable: false, maxLength: null, ordinalPosition: 3 },
    ]));
    expect(result).toBeNull();
  });

  it('picks varchar with null maxLength (unlimited) over one with maxLength', () => {
    const result = pickTextColumn(makeIntrospection([
      { name: 'short_col', dataType: 'character varying', nullable: false, maxLength: 100, ordinalPosition: 1 },
      { name: 'unlimited_col', dataType: 'character varying', nullable: true, maxLength: null, ordinalPosition: 2 },
    ]));
    expect(result).toBe('unlimited_col');
  });

  it('handles citext and json types', () => {
    const result = pickTextColumn(makeIntrospection([
      { name: 'id', dataType: 'integer', nullable: false, maxLength: null, ordinalPosition: 1 },
      { name: 'email', dataType: 'citext', nullable: false, maxLength: null, ordinalPosition: 2 },
    ]));
    expect(result).toBe('email');
  });
});
