import { describe, it, expect, beforeEach } from 'vitest';
import { Blink } from '../src/blink.js';

// Test the MCP server indirectly through the Blink class methods
// (since MCP tools just call Blink methods)

describe('MCP tool backing methods', () => {
  let blink: Blink;

  beforeEach(() => {
    blink = new Blink({ dbPath: ':memory:' });
  });

  describe('blink.get()', () => {
    it('should return record by exact path', () => {
      const saved = blink.save({
        namespace: 'me',
        title: 'Background',
        type: 'SUMMARY',
        summary: 'I am a software engineer',
      });

      const record = blink.get('me/background');
      expect(record).toBeTruthy();
      expect(record?.path).toBe('me/background');
      expect(record?.title).toBe('Background');
    });

    it('should return null if record not found', () => {
      const record = blink.get('nonexistent/path');
      expect(record).toBeNull();
    });

    it('should not follow ALIAS (exact path only)', () => {
      blink.save({
        namespace: 'me',
        title: 'Background',
        type: 'SUMMARY',
        summary: 'Original',
      });

      blink.save({
        namespace: 'me',
        title: 'Bio',
        type: 'ALIAS',
        content: { target: 'me/background' },
      });

      const alias = blink.get('me/bio');
      expect(alias).toBeTruthy();
      expect(alias?.type).toBe('ALIAS');
      expect(alias?.path).toBe('me/bio');
    });
  });

  describe('blink.delete()', () => {
    it('should delete a record and return true', () => {
      blink.save({
        namespace: 'temp',
        title: 'Test',
        type: 'SUMMARY',
        summary: 'To be deleted',
      });

      const deleted = blink.delete('temp/test');
      expect(deleted).toBe(true);

      const record = blink.get('temp/test');
      expect(record).toBeNull();
    });

    it('should return false if record does not exist', () => {
      const deleted = blink.delete('nonexistent/path');
      expect(deleted).toBe(false);
    });
  });

  describe('blink.move()', () => {
    it('should move a record to a new path', () => {
      blink.save({
        namespace: 'old',
        title: 'Name',
        type: 'SUMMARY',
        summary: 'Original content',
      });

      const moved = blink.move('old/name', 'new/name');
      expect(moved).toBeTruthy();
      expect(moved?.path).toBe('new/name');
      expect(moved?.summary).toBe('Original content');

      const oldRecord = blink.get('old/name');
      expect(oldRecord).toBeNull();

      const newRecord = blink.get('new/name');
      expect(newRecord).toBeTruthy();
      expect(newRecord?.path).toBe('new/name');
    });

    it('should return null if source record does not exist', () => {
      const moved = blink.move('nonexistent/path', 'new/path');
      expect(moved).toBeNull();
    });
  });

  describe('blink.zones()', () => {
    it('should list all zones with counts', () => {
      blink.save({
        namespace: 'me',
        title: 'Background',
        type: 'SUMMARY',
        summary: 'Bio',
      });

      blink.save({
        namespace: 'projects',
        title: 'Alpha',
        type: 'SUMMARY',
        summary: 'Project info',
      });

      blink.save({
        namespace: 'projects',
        title: 'Beta',
        type: 'SUMMARY',
        summary: 'Another project',
      });

      const zones = blink.zones();
      expect(zones.length).toBe(2);

      const meZone = zones.find((z) => z.path === 'me');
      expect(meZone).toBeTruthy();
      expect(meZone?.record_count).toBe(1);

      const projectsZone = zones.find((z) => z.path === 'projects');
      expect(projectsZone).toBeTruthy();
      expect(projectsZone?.record_count).toBe(2);
    });

    it('should return empty array if no records exist', () => {
      const zones = blink.zones();
      expect(zones).toEqual([]);
    });
  });

  describe('RecordType validation', () => {
    it('should accept all valid RecordType values', () => {
      const types: Array<'SUMMARY' | 'META' | 'COLLECTION' | 'SOURCE'> = [
        'SUMMARY',
        'META',
        'COLLECTION',
        'SOURCE',
      ];

      for (const type of types) {
        const record = blink.save({
          namespace: 'test',
          title: `Type ${type}`,
          type,
          summary: `Testing ${type}`,
        });
        expect(record.type).toBe(type);
      }

      // ALIAS requires content.target
      const aliasRecord = blink.save({
        namespace: 'test',
        title: 'Type ALIAS',
        type: 'ALIAS',
        content: { target: 'test/target' },
      });
      expect(aliasRecord.type).toBe('ALIAS');
    });

    it('should save COLLECTION type records', () => {
      const record = blink.save({
        namespace: 'collections',
        title: 'My Collection',
        type: 'COLLECTION',
        summary: 'A collection of items',
      });

      expect(record.type).toBe('COLLECTION');
      expect(record.path).toBe('collections/my-collection');
    });
  });

  describe('Input length validation scenarios', () => {
    it('should handle maximum valid lengths', () => {
      const longTitle = 'A'.repeat(1000);
      const longSummary = 'B'.repeat(100_000);

      const record = blink.save({
        namespace: 'test',
        title: longTitle,
        type: 'SUMMARY',
        summary: longSummary,
      });

      expect(record.title).toBe(longTitle);
      expect(record.summary).toBe(longSummary);
    });

    it('should handle search with keywords', () => {
      blink.save({
        namespace: 'docs',
        title: 'Authentication Guide',
        type: 'SUMMARY',
        summary: 'How to authenticate users',
        tags: ['auth', 'security'],
      });

      const results = blink.search('authentication security');
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('blink.ingest() — backing for blink_ingest MCP tool', () => {
    it('ingests a batch of wiki documents and returns records', async () => {
      const { WIKI_DERIVERS, extractiveSummarize } = await import('../src/ingest.js');
      const result = await blink.ingest(
        [
          {
            id: 'doc-1',
            text: '# MCP Overview\n\nThe Model Context Protocol defines tool access for LLMs.',
            metadata: { file_name: 'mcp.md', file_path: 'sources/mcp.md' },
          },
          {
            id: 'doc-2',
            text: '# Discovery\n\nDiscovery is how clients find tools.',
            metadata: { file_name: 'discovery.md', file_path: 'sources/discovery.md' },
          },
        ],
        { ...WIKI_DERIVERS, summarize: extractiveSummarize(2000) },
      );

      expect(result.records).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.errors).toEqual([]);
      expect(result.records[0].type).toBe('SUMMARY');
    });

    it('extractLinks: true creates ALIAS records for resolved targets', async () => {
      const { WIKI_DERIVERS, extractiveSummarize } = await import('../src/ingest.js');
      blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 't' });

      const result = await blink.ingest(
        [
          {
            id: 'doc-1',
            text: '# Note\n\nSee [[transport]] for details.',
            metadata: { file_name: 'note.md', file_path: 'sources/note.md' },
          },
        ],
        { ...WIKI_DERIVERS, summarize: extractiveSummarize(2000), extractLinks: true },
      );

      expect(result.aliasesCreated).toBe(1);
      expect(result.unresolvedLinks).toEqual([]);
    });

    it('handles a SOURCE-classified document via frontmatter source_url', async () => {
      const { WIKI_DERIVERS, extractiveSummarize } = await import('../src/ingest.js');
      const result = await blink.ingest(
        [
          {
            id: 'doc-1',
            text: '# Article\n\nfull text here',
            metadata: {
              file_name: 'article.md',
              file_path: 'sources/article.md',
              frontmatter: { source_url: 'https://example.com/article' },
            },
          },
        ],
        { ...WIKI_DERIVERS, summarize: extractiveSummarize(2000) },
      );

      expect(result.records[0].type).toBe('SOURCE');
    });

    it('handles a META document with structured frontmatter content', async () => {
      const { WIKI_DERIVERS, extractiveSummarize } = await import('../src/ingest.js');
      const result = await blink.ingest(
        [
          {
            id: 'doc-1',
            text: '{}',
            metadata: {
              file_name: 'config.json',
              file_path: 'sources/config.json',
              frontmatter: { content: { max: 100, enabled: true } },
            },
          },
        ],
        { ...WIKI_DERIVERS, summarize: extractiveSummarize(2000) },
      );

      expect(result.records[0].type).toBe('META');
      expect(result.records[0].content).toEqual({ max: 100, enabled: true });
    });
  });
});
