import { describe, it, expect, beforeEach } from 'vitest';
import { Blink } from '../src/blink.js';
import { extractWikiLinks, WIKI_DERIVERS, extractiveSummarize } from '../src/ingest.js';
import type { IngestDocument } from '../src/types.js';

function newBlink(): Blink {
  return new Blink({ dbPath: ':memory:' });
}

// ─── extractWikiLinks (standalone function) ─────────────────

describe('extractWikiLinks', () => {
  let blink: Blink;
  beforeEach(() => {
    blink = newBlink();
  });

  it('extracts a single wikilink and creates an ALIAS to the resolved target', () => {
    blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 'how transports work' });
    const source = blink.save({
      namespace: 'sources',
      title: 'mcp-spec',
      type: 'SUMMARY',
      summary: 'See [[transport]] for the wire protocol details.',
    });

    const result = extractWikiLinks(blink, [source]);

    expect(result.aliasesCreated).toBe(1);
    expect(result.unresolvedLinks).toEqual([]);
    expect(result.aliases[0].type).toBe('ALIAS');
    expect(result.aliases[0].namespace).toBe('sources/mcp-spec/aliases');
    expect((result.aliases[0].content as { target: string }).target).toBe('topics/transport');
  });

  it('handles the [[target|display]] form', () => {
    blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 'transport docs' });
    const source = blink.save({
      namespace: 'sources',
      title: 'note',
      type: 'SUMMARY',
      summary: 'See [[transport|the transport layer]] for details.',
    });

    const result = extractWikiLinks(blink, [source]);

    expect(result.aliasesCreated).toBe(1);
    expect(result.aliases[0].title).toBe('transport');
    expect((result.aliases[0].content as { target: string }).target).toBe('topics/transport');
  });

  it('dedupes multiple references to the same target in one source', () => {
    blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 'x' });
    const source = blink.save({
      namespace: 'sources',
      title: 'note',
      type: 'SUMMARY',
      summary: 'First [[transport]], then [[transport]] again, and one more [[transport|see here]].',
    });

    const result = extractWikiLinks(blink, [source]);

    expect(result.aliasesCreated).toBe(1);
  });

  it('extracts multiple distinct wikilinks from one source', () => {
    blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 't' });
    blink.save({ namespace: 'topics', title: 'discovery', type: 'SUMMARY', summary: 'd' });
    blink.save({ namespace: 'topics', title: 'lifecycle', type: 'SUMMARY', summary: 'l' });

    const source = blink.save({
      namespace: 'sources',
      title: 'note',
      type: 'SUMMARY',
      summary: 'See [[transport]], [[discovery]], and [[lifecycle]].',
    });

    const result = extractWikiLinks(blink, [source]);

    expect(result.aliasesCreated).toBe(3);
    const titles = result.aliases.map(a => a.title).sort();
    expect(titles).toEqual(['discovery', 'lifecycle', 'transport']);
  });

  it('reports unresolved targets without creating ALIAS records', () => {
    const source = blink.save({
      namespace: 'sources',
      title: 'note',
      type: 'SUMMARY',
      summary: 'See [[nonexistent-topic]] and [[also-missing]].',
    });

    const result = extractWikiLinks(blink, [source]);

    expect(result.aliasesCreated).toBe(0);
    expect(result.unresolvedLinks).toContain('nonexistent-topic');
    expect(result.unresolvedLinks).toContain('also-missing');
  });

  it('skips records with no summary', () => {
    blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 't' });
    const source = blink.save({
      namespace: 'sources',
      title: 'just-a-pointer',
      type: 'SOURCE',
      content: { url: 'https://example.com' },
    });

    const result = extractWikiLinks(blink, [source]);

    expect(result.aliasesCreated).toBe(0);
  });

  it('skips ALIAS records (never extracts from aliases themselves)', () => {
    blink.save({ namespace: 'topics', title: 'real', type: 'SUMMARY', summary: 'r' });
    const aliasRecord = blink.save({
      namespace: 'sources/x/aliases',
      title: 'foo',
      type: 'ALIAS',
      summary: 'See [[real]]',
      content: { target: 'topics/real' },
    });

    const result = extractWikiLinks(blink, [aliasRecord]);

    expect(result.aliasesCreated).toBe(0);
  });

  it('does not create a self-referential ALIAS', () => {
    const source = blink.save({
      namespace: 'topics',
      title: 'transport',
      type: 'SUMMARY',
      summary: 'this page is about [[transport]] itself',
    });

    const result = extractWikiLinks(blink, [source]);

    expect(result.aliasesCreated).toBe(0);
  });

  it('extracts links from multiple source records in one call', () => {
    blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 't' });
    blink.save({ namespace: 'topics', title: 'discovery', type: 'SUMMARY', summary: 'd' });

    const a = blink.save({
      namespace: 'sources',
      title: 'note-a',
      type: 'SUMMARY',
      summary: 'about [[transport]]',
    });
    const b = blink.save({
      namespace: 'sources',
      title: 'note-b',
      type: 'SUMMARY',
      summary: 'about [[discovery]]',
    });

    const result = extractWikiLinks(blink, [a, b]);

    expect(result.aliasesCreated).toBe(2);
    expect(result.aliases.find(r => r.namespace === 'sources/note-a/aliases')).toBeDefined();
    expect(result.aliases.find(r => r.namespace === 'sources/note-b/aliases')).toBeDefined();
  });

  it('ignores empty link text [[]]', () => {
    const source = blink.save({
      namespace: 'sources',
      title: 'note',
      type: 'SUMMARY',
      summary: 'malformed [[]] and [[ ]] links here',
    });

    const result = extractWikiLinks(blink, [source]);
    expect(result.aliasesCreated).toBe(0);
    expect(result.unresolvedLinks).toEqual([]);
  });

  it('does not match links containing newlines (not real wikilinks)', () => {
    const source = blink.save({
      namespace: 'sources',
      title: 'note',
      type: 'SUMMARY',
      summary: 'broken [[multi\nline]] link',
    });

    const result = extractWikiLinks(blink, [source]);
    expect(result.aliasesCreated).toBe(0);
  });
});

// ─── Integration via Blink.ingest({ extractLinks: true }) ──

describe('Blink.ingest with extractLinks: true', () => {
  it('runs extraction automatically and populates result fields', async () => {
    const blink = newBlink();

    // Pre-populate target records
    blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 't' });
    blink.save({ namespace: 'topics', title: 'discovery', type: 'SUMMARY', summary: 'd' });

    const docs: IngestDocument[] = [
      {
        id: 'doc-1',
        text: '# MCP Overview\n\nMCP defines [[transport]] and [[discovery]] semantics.',
        metadata: { file_name: 'mcp-overview.md', file_path: 'sources/mcp-overview.md' },
      },
    ];

    const result = await blink.ingest(docs, {
      ...WIKI_DERIVERS,
      summarize: extractiveSummarize(2000),
      extractLinks: true,
    });

    expect(result.records).toHaveLength(1);
    expect(result.aliasesCreated).toBe(2);
    expect(result.unresolvedLinks).toEqual([]);
  });

  it('does not run extraction when extractLinks is false/undefined', async () => {
    const blink = newBlink();
    blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 't' });

    const docs: IngestDocument[] = [
      {
        id: 'doc-1',
        text: '# MCP\n\nUses [[transport]] semantics.',
        metadata: { file_name: 'mcp.md', file_path: 'sources/mcp.md' },
      },
    ];

    const result = await blink.ingest(docs, {
      ...WIKI_DERIVERS,
      summarize: extractiveSummarize(2000),
    });

    expect(result.aliasesCreated).toBeUndefined();
    expect(result.unresolvedLinks).toBeUndefined();
  });

  it('reports unresolved targets via the result', async () => {
    const blink = newBlink();

    const docs: IngestDocument[] = [
      {
        id: 'doc-1',
        text: '# Note\n\nReferences [[ghost-page]] which does not exist.',
        metadata: { file_name: 'note.md', file_path: 'sources/note.md' },
      },
    ];

    const result = await blink.ingest(docs, {
      ...WIKI_DERIVERS,
      summarize: extractiveSummarize(2000),
      extractLinks: true,
    });

    expect(result.aliasesCreated).toBe(0);
    expect(result.unresolvedLinks).toContain('ghost-page');
  });
});
