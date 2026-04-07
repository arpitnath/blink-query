import { describe, it, expect, beforeEach } from 'vitest';
import { Blink } from '../src/blink.js';

// Tests for pagination behavior in blink_list and blink_search MCP tool handlers.
// We test via the Blink class directly since MCP handlers delegate to blink.list/blink.search.

describe('MCP pagination — blink_list', () => {
  let blink: Blink;

  beforeEach(() => {
    blink = new Blink({ dbPath: ':memory:' });

    // Insert 60 records in the 'docs' namespace
    for (let i = 1; i <= 60; i++) {
      blink.save({
        namespace: 'docs',
        title: `Article ${String(i).padStart(3, '0')}`,
        type: 'SUMMARY',
        summary: `Content for article ${i}`,
      });
    }
  });

  it('returns max 50 by default (simulating default limit)', () => {
    const limit = Math.min(50, 200); // MCP handler default
    const offset = 0;
    const results = blink.list('docs', 'recent', { limit, offset });
    expect(results.length).toBe(50);
  });

  it('returns requested number of results with explicit limit=10', () => {
    const limit = Math.min(10, 200);
    const offset = 0;
    const results = blink.list('docs', 'recent', { limit, offset });
    expect(results.length).toBe(10);
  });

  it('offsets results correctly', () => {
    // Get first 10
    const first10 = blink.list('docs', 'title', { limit: 10, offset: 0 });
    // Get next 10 with offset=10
    const next10 = blink.list('docs', 'title', { limit: 10, offset: 10 });

    expect(first10.length).toBe(10);
    expect(next10.length).toBe(10);

    // No overlap between the two pages
    const first10Paths = new Set(first10.map((r) => r.path));
    for (const record of next10) {
      expect(first10Paths.has(record.path)).toBe(false);
    }
  });

  it('returns empty array when offset exceeds total records', () => {
    const results = blink.list('docs', 'recent', { limit: 50, offset: 1000 });
    expect(results).toEqual([]);
  });

  it('clamps limit to 200 max', () => {
    // Simulate the MCP handler clamping: Math.min(requestedLimit, 200)
    const requestedLimit = 999;
    const limit = Math.min(requestedLimit, 200);
    const offset = 0;
    // Only 60 records exist, so results will be 60 (less than clamped 200)
    const results = blink.list('docs', 'recent', { limit, offset });
    expect(limit).toBe(200);
    expect(results.length).toBe(60); // all 60 records, well under the 200 cap
  });

  it('returns correct offset and limit in MCP-style response', () => {
    const limit = Math.min(10, 200);
    const offset = 5;
    const results = blink.list('docs', 'recent', { limit, offset });
    // Simulate what the MCP handler returns
    const response = { count: results.length, results, offset, limit };
    expect(response.limit).toBe(10);
    expect(response.offset).toBe(5);
    expect(response.count).toBe(results.length);
  });
});

describe('MCP pagination — blink_search', () => {
  let blink: Blink;

  beforeEach(() => {
    blink = new Blink({ dbPath: ':memory:' });

    // Insert records with searchable content
    for (let i = 1; i <= 30; i++) {
      blink.save({
        namespace: 'knowledge',
        title: `Guide ${String(i).padStart(3, '0')}`,
        type: 'SUMMARY',
        summary: `This guide explains authentication concepts and security patterns ${i}`,
        tags: ['auth', 'security'],
      });
    }
  });

  it('returns default limit=10 results when no limit specified', () => {
    const limit = Math.min(10, 200); // MCP handler default
    const offset = 0;
    const results = blink.search('authentication', { limit, offset });
    expect(results.length).toBeLessThanOrEqual(10);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns limited results with explicit limit', () => {
    const limit = Math.min(5, 200);
    const offset = 0;
    const results = blink.search('authentication', { limit, offset });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('offsets search results correctly', () => {
    const page1 = blink.search('authentication', { limit: 5, offset: 0 });
    const page2 = blink.search('authentication', { limit: 5, offset: 5 });

    // Both pages should have results
    expect(page1.length).toBeGreaterThan(0);

    // No overlap between pages (if there are enough results)
    if (page2.length > 0) {
      const page1Paths = new Set(page1.map((r) => r.path));
      for (const record of page2) {
        expect(page1Paths.has(record.path)).toBe(false);
      }
    }
  });

  it('clamps limit to 200 max', () => {
    const requestedLimit = 500;
    const limit = Math.min(requestedLimit, 200);
    expect(limit).toBe(200);

    const offset = 0;
    const results = blink.search('authentication', { limit, offset });
    // 30 records exist, all matching — well under the 200 cap
    expect(results.length).toBeLessThanOrEqual(30);
  });

  it('returns correct offset and limit in MCP-style response', () => {
    const limit = Math.min(5, 200);
    const offset = 2;
    const results = blink.search('security', { limit, offset });
    const response = { count: results.length, results, offset, limit };
    expect(response.limit).toBe(5);
    expect(response.offset).toBe(2);
    expect(response.count).toBe(results.length);
  });

  it('namespace filter works with pagination', () => {
    // Add records in a different namespace
    blink.save({
      namespace: 'other',
      title: 'Other Auth Guide',
      type: 'SUMMARY',
      summary: 'Authentication in another namespace',
    });

    const limit = Math.min(50, 200);
    const offset = 0;
    const results = blink.search('authentication', { namespace: 'knowledge', limit, offset });

    // All results should be in the 'knowledge' namespace
    for (const record of results) {
      expect(record.namespace).toBe('knowledge');
    }
  });
});
