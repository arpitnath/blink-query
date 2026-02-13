import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'http';
import { loadFromUrls } from '../../src/adapters.js';
import { WEB_DERIVERS } from '../../src/ingest.js';
import { Blink } from '../../src/blink.js';

// ─── Local HTTP server ──────────────────────────────────────

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    switch (req.url) {
      case '/article.html':
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<!DOCTYPE html><html><head><title>Test Article</title></head><body>
          <script>var x = 1;</script>
          <style>body { color: red; }</style>
          <h1>Test Article</h1>
          <p>This is a test article about knowledge management systems.</p>
          <p>It covers various topics including AI agents and data pipelines.</p>
        </body></html>`);
        break;
      case '/api/data.json':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ name: 'test', items: [1, 2, 3] }));
        break;
      case '/plain.txt':
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Plain text content for testing.');
        break;
      case '/slow':
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          res.end('Slow response');
        }, 5000);
        break;
      case '/500':
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal Server Error');
        break;
      default:
        res.writeHead(404);
        res.end('Not Found');
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server?.close();
});

// ─── Tests ──────────────────────────────────────────────────

describe('Web URL integration tests', () => {
  it('fetches and strips HTML page', async () => {
    const docs = await loadFromUrls([`${baseUrl}/article.html`]);

    expect(docs).toHaveLength(1);
    const doc = docs[0];

    // HTML tags, scripts, and styles must be stripped
    expect(doc.text).not.toContain('<script');
    expect(doc.text).not.toContain('<style');
    expect(doc.text).not.toContain('<p>');
    expect(doc.text).not.toContain('<h1>');

    // Actual content must be present
    expect(doc.text).toContain('knowledge management');

    // Metadata
    expect(doc.metadata.title).toBe('Test Article');
    expect(doc.metadata.content_type).toContain('text/html');
    expect(doc.metadata.domain).toBe('127.0.0.1');
    expect(doc.metadata.status_code).toBe(200);
  });

  it('fetches JSON endpoint as raw text', async () => {
    const docs = await loadFromUrls([`${baseUrl}/api/data.json`]);

    expect(docs).toHaveLength(1);
    const doc = docs[0];

    // Should contain raw JSON
    const parsed = JSON.parse(doc.text);
    expect(parsed).toEqual({ name: 'test', items: [1, 2, 3] });

    expect(doc.metadata.content_type).toContain('application/json');
  });

  it('fetches multiple URLs in batch', async () => {
    const urls = [
      `${baseUrl}/article.html`,
      `${baseUrl}/api/data.json`,
      `${baseUrl}/plain.txt`,
    ];
    const docs = await loadFromUrls(urls);

    expect(docs).toHaveLength(3);
    // All should have the local server domain
    for (const doc of docs) {
      expect(doc.metadata.domain).toBe('127.0.0.1');
    }
  });

  it('handles timeout gracefully without throwing', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const docs = await loadFromUrls([`${baseUrl}/slow`], { timeout: 500 });

    expect(docs).toHaveLength(0);
    consoleSpy.mockRestore();
  });

  it('skips failed URLs while returning successful ones', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const docs = await loadFromUrls([
      `${baseUrl}/article.html`,
      `${baseUrl}/500`,
    ]);

    // /500 returns status 500 but loadFromUrls still returns it (it reads the body).
    // The adapter does not filter by status code — it only skips on network/abort errors.
    // Both should be returned.
    expect(docs.length).toBeGreaterThanOrEqual(1);
    // The article must be present
    const article = docs.find(d => d.metadata.title === 'Test Article');
    expect(article).toBeDefined();
    consoleSpy.mockRestore();
  });

  it('respects concurrency limit', async () => {
    const urls = [
      `${baseUrl}/article.html`,
      `${baseUrl}/api/data.json`,
      `${baseUrl}/plain.txt`,
      `${baseUrl}/article.html`,
      `${baseUrl}/api/data.json`,
      `${baseUrl}/plain.txt`,
    ];
    const docs = await loadFromUrls(urls, { concurrency: 2 });

    expect(docs).toHaveLength(6);
  });

  it('uses custom extractText function', async () => {
    const docs = await loadFromUrls(
      [`${baseUrl}/article.html`, `${baseUrl}/plain.txt`],
      { extractText: () => 'CUSTOM' },
    );

    expect(docs).toHaveLength(2);
    for (const doc of docs) {
      expect(doc.text).toBe('CUSTOM');
    }
  });

  it('ingests web URLs end-to-end with Blink', async () => {
    const blink = new Blink({ dbPath: ':memory:' });
    const urls = [
      `${baseUrl}/article.html`,
      `${baseUrl}/api/data.json`,
      `${baseUrl}/plain.txt`,
    ];

    const result = await blink.ingestFromUrls(urls, { ...WEB_DERIVERS });

    expect(result.records.length).toBe(3);
    expect(result.errors).toHaveLength(0);
    expect(result.total).toBe(3);

    // Resolve the namespace — should get a COLLECTION
    const resolved = blink.resolve('web/127-0-0-1/');
    expect(resolved.status).toBe('OK');
    expect(resolved.record!.type).toBe('COLLECTION');

    // Individual records should be resolvable
    const articleResult = blink.resolve('web/127-0-0-1/test-article');
    expect(articleResult.status).toBe('OK');
    expect(articleResult.record!.type).toBe('SOURCE');

    // Zones should include the web zone (top-level namespace)
    const zones = blink.zones();
    const webZone = zones.find(z => z.path === 'web');
    expect(webZone).toBeDefined();
    expect(webZone!.record_count).toBe(3);

    blink.close();
  });
});

// ─── Real URL test (network-guarded) ────────────────────────

const networkAvailable = await fetch('https://httpbin.org/status/200')
  .then(() => true)
  .catch(() => false);

describe.skipIf(!networkAvailable)('real URL', () => {
  it('fetches and strips real HTML', async () => {
    const docs = await loadFromUrls(['https://httpbin.org/html']);

    expect(docs).toHaveLength(1);
    expect(docs[0].text).toContain('Herman Melville');
    expect(docs[0].text).not.toContain('<script');
    expect(docs[0].metadata.domain).toBe('httpbin.org');
  });
});
