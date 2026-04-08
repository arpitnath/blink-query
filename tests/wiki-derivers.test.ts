import { describe, it, expect } from 'vitest';
import {
  WIKI_DERIVERS,
  wikiClassify,
  wikiNamespace,
  wikiTitle,
  wikiTags,
  wikiSources,
  documentToSaveInput,
} from '../src/ingest.js';

// ─── WIKI_DERIVERS shape ────────────────────────────────────

describe('WIKI_DERIVERS', () => {
  it('has the correct shape', () => {
    expect(WIKI_DERIVERS.classify).toBe(wikiClassify);
    expect(WIKI_DERIVERS.deriveNamespace).toBe(wikiNamespace);
    expect(WIKI_DERIVERS.deriveTitle).toBe(wikiTitle);
    expect(WIKI_DERIVERS.deriveTags).toBe(wikiTags);
    expect(WIKI_DERIVERS.buildSources).toBe(wikiSources);
  });

  it('bundles a classify function (unlike other presets)', () => {
    expect(typeof WIKI_DERIVERS.classify).toBe('function');
  });
});

// ─── wikiClassify ───────────────────────────────────────────

describe('wikiClassify', () => {
  describe('frontmatter type override (highest precedence)', () => {
    it('respects type: source', () => {
      expect(wikiClassify('# Heading', { frontmatter: { type: 'source' } })).toBe('SOURCE');
    });

    it('respects type: summary', () => {
      expect(wikiClassify('plain text', { frontmatter: { type: 'summary' } })).toBe('SUMMARY');
    });

    it('respects type: meta', () => {
      expect(wikiClassify('plain text', { frontmatter: { type: 'meta' } })).toBe('META');
    });

    it('respects type: collection', () => {
      expect(wikiClassify('plain text', { frontmatter: { type: 'collection' } })).toBe('COLLECTION');
    });

    it('respects type: alias', () => {
      expect(wikiClassify('plain text', { frontmatter: { type: 'alias' } })).toBe('ALIAS');
    });

    it('is case-insensitive on the type value', () => {
      expect(wikiClassify('x', { frontmatter: { type: 'SUMMARY' } })).toBe('SUMMARY');
      expect(wikiClassify('x', { frontmatter: { type: 'Source' } })).toBe('SOURCE');
    });

    it('overrides extension and source_url', () => {
      expect(
        wikiClassify('# heading', {
          file_name: 'config.json',
          frontmatter: { type: 'summary', source_url: 'https://example.com' },
        }),
      ).toBe('SUMMARY');
    });
  });

  describe('extension-based META classification', () => {
    it('classifies .json files as META', () => {
      expect(wikiClassify('{}', { file_name: 'config.json' })).toBe('META');
    });

    it('classifies .yaml files as META', () => {
      expect(wikiClassify('foo: bar', { file_name: 'config.yaml' })).toBe('META');
    });

    it('classifies .yml files as META', () => {
      expect(wikiClassify('foo: bar', { file_name: 'config.yml' })).toBe('META');
    });

    it('is case-insensitive on extension', () => {
      expect(wikiClassify('{}', { file_name: 'CONFIG.JSON' })).toBe('META');
    });
  });

  describe('source_url frontmatter (provenance signal)', () => {
    it('classifies as SOURCE when source_url is set', () => {
      expect(
        wikiClassify('# Heading', {
          file_name: 'foo.md',
          frontmatter: { source_url: 'https://spec.modelcontextprotocol.io/' },
        }),
      ).toBe('SOURCE');
    });

    it('also accepts the shorthand url field', () => {
      expect(
        wikiClassify('# Heading', {
          file_name: 'foo.md',
          frontmatter: { url: 'https://example.com' },
        }),
      ).toBe('SOURCE');
    });

    it('source_url overrides the heading-based SUMMARY heuristic', () => {
      expect(
        wikiClassify('# Big Heading\n\nlots of content', {
          file_name: 'note.md',
          frontmatter: { source_url: 'https://example.com' },
        }),
      ).toBe('SOURCE');
    });

    it('ignores empty source_url string', () => {
      expect(
        wikiClassify('# Heading', {
          file_name: 'note.md',
          frontmatter: { source_url: '' },
        }),
      ).toBe('SUMMARY');
    });
  });

  describe('markdown heading → SUMMARY', () => {
    it('classifies .md with H1 as SUMMARY', () => {
      expect(wikiClassify('# Title\n\ncontent', { file_name: 'note.md' })).toBe('SUMMARY');
    });

    it('classifies .md with H2 as SUMMARY', () => {
      expect(wikiClassify('## Subheading', { file_name: 'note.md' })).toBe('SUMMARY');
    });

    it('classifies .markdown extension as SUMMARY when headed', () => {
      expect(wikiClassify('# Title', { file_name: 'note.markdown' })).toBe('SUMMARY');
    });

    it('does not require the heading to be on the first line', () => {
      expect(wikiClassify('intro\n\n## later heading', { file_name: 'note.md' })).toBe('SUMMARY');
    });

    it('falls through to SOURCE for .md without any heading', () => {
      expect(wikiClassify('plain text, no headings', { file_name: 'note.md' })).toBe('SOURCE');
    });
  });

  describe('default fallback', () => {
    it('returns SOURCE for unknown extensions', () => {
      expect(wikiClassify('content', { file_name: 'data.txt' })).toBe('SOURCE');
    });

    it('returns SOURCE when metadata is empty', () => {
      expect(wikiClassify('content', {})).toBe('SOURCE');
    });
  });
});

// ─── wikiNamespace ──────────────────────────────────────────

describe('wikiNamespace', () => {
  describe('frontmatter namespace override', () => {
    it('respects frontmatter namespace', () => {
      expect(
        wikiNamespace({
          file_path: 'sources/foo.md',
          frontmatter: { namespace: 'custom/path' },
        }),
      ).toBe('custom/path');
    });

    it('overrides path-based routing', () => {
      expect(
        wikiNamespace({
          file_path: 'entity/alice/bio.md',
          frontmatter: { namespace: 'people/alice' },
        }),
      ).toBe('people/alice');
    });

    it('ignores empty namespace string', () => {
      expect(
        wikiNamespace({
          file_path: 'sources/foo.md',
          frontmatter: { namespace: '' },
        }),
      ).toBe('sources');
    });
  });

  describe('path-based routing', () => {
    it('routes root files to sources', () => {
      expect(wikiNamespace({ file_path: 'foo.md' })).toBe('sources');
    });

    it('routes sources/ subdir to sources', () => {
      expect(wikiNamespace({ file_path: 'sources/foo.md' })).toBe('sources');
    });

    it('routes entity/<name>/<file> to entity/<slug>', () => {
      expect(wikiNamespace({ file_path: 'entity/alice/bio.md' })).toBe('entity/alice');
    });

    it('slugifies entity names', () => {
      expect(wikiNamespace({ file_path: 'entity/Alice Smith/bio.md' })).toBe('entity/alice-smith');
    });

    it('routes topics/<name>/<file> to topics/<slug>', () => {
      expect(wikiNamespace({ file_path: 'topics/mcp-protocol/overview.md' })).toBe('topics/mcp-protocol');
    });

    it('routes log/<date>/<file> to log/<date>', () => {
      expect(wikiNamespace({ file_path: 'log/2026-04-08/ingest.md' })).toBe('log/2026-04-08');
    });

    it('rejects non-iso log subdirs and falls through', () => {
      expect(wikiNamespace({ file_path: 'log/today/ingest.md' })).toBe('log/today');
    });

    it('preserves arbitrary directory structures as namespace', () => {
      expect(wikiNamespace({ file_path: 'projects/foo/bar.md' })).toBe('projects/foo');
    });

    it('handles backslash paths (windows)', () => {
      expect(wikiNamespace({ file_path: 'entity\\bob\\bio.md' })).toBe('entity/bob');
    });

    it('strips leading ./', () => {
      expect(wikiNamespace({ file_path: './sources/foo.md' })).toBe('sources');
    });

    it('returns sources when file_path is missing', () => {
      expect(wikiNamespace({})).toBe('sources');
    });
  });
});

// ─── wikiTitle ──────────────────────────────────────────────

describe('wikiTitle', () => {
  it('prefers frontmatter title', () => {
    expect(
      wikiTitle({
        file_name: 'foo.md',
        frontmatter: { title: 'Real Title' },
      }),
    ).toBe('Real Title');
  });

  it('falls back to file_name minus extension', () => {
    expect(wikiTitle({ file_name: 'mcp-spec.md' })).toBe('mcp-spec');
  });

  it('handles files without extension', () => {
    expect(wikiTitle({ file_name: 'README' })).toBe('README');
  });

  it('returns "untitled" when file_name is missing', () => {
    expect(wikiTitle({})).toBe('untitled');
  });

  it('ignores empty frontmatter title', () => {
    expect(
      wikiTitle({
        file_name: 'foo.md',
        frontmatter: { title: '' },
      }),
    ).toBe('foo');
  });
});

// ─── wikiTags ───────────────────────────────────────────────

describe('wikiTags', () => {
  it('always includes "wiki" as a base tag', () => {
    expect(wikiTags({})).toContain('wiki');
  });

  it('includes frontmatter tags', () => {
    const tags = wikiTags({ frontmatter: { tags: ['mcp', 'protocol'] } });
    expect(tags).toContain('mcp');
    expect(tags).toContain('protocol');
  });

  it('includes file extension as a tag', () => {
    const tags = wikiTags({ file_name: 'spec.md' });
    expect(tags).toContain('md');
  });

  it('includes top-level directory as a tag', () => {
    const tags = wikiTags({ file_path: 'entity/alice/bio.md', file_name: 'bio.md' });
    expect(tags).toContain('entity');
  });

  it('lowercases all tags', () => {
    const tags = wikiTags({ frontmatter: { tags: ['MCP', 'Protocol'] } });
    expect(tags).toContain('mcp');
    expect(tags).toContain('protocol');
    expect(tags).not.toContain('MCP');
  });

  it('deduplicates tags', () => {
    const tags = wikiTags({
      frontmatter: { tags: ['wiki', 'wiki'] },
      file_name: 'foo.md',
    });
    expect(tags.filter(t => t === 'wiki').length).toBe(1);
  });

  it('appends extra tags from second arg', () => {
    const tags = wikiTags({}, ['custom', 'tag']);
    expect(tags).toContain('custom');
    expect(tags).toContain('tag');
  });

  it('skips non-string entries in frontmatter tags', () => {
    const tags = wikiTags({ frontmatter: { tags: ['real', 42, null, 'also-real'] } });
    expect(tags).toContain('real');
    expect(tags).toContain('also-real');
    expect(tags).not.toContain('42');
  });
});

// ─── wikiSources ────────────────────────────────────────────

describe('wikiSources', () => {
  it('produces a file source with file_path', () => {
    const sources = wikiSources({ file_path: 'sources/foo.md' });
    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe('file');
    expect(sources[0].file_path).toBe('sources/foo.md');
    expect(sources[0].last_fetched).toBeDefined();
  });

  it('returns empty array when file_path is missing', () => {
    expect(wikiSources({})).toEqual([]);
  });
});

// ─── content field survives ingest for all record types ────

describe('documentToSaveInput content field', () => {
  it('SOURCE: tracks original_id and source_metadata (existing behavior)', async () => {
    const result = await documentToSaveInput(
      { id: 'src-1', text: 'content', metadata: { file_name: 'foo.md', frontmatter: { source_url: 'https://example.com' } } },
      { ...WIKI_DERIVERS },
    );
    expect(result.type).toBe('SOURCE');
    expect(result.content).toEqual({
      original_id: 'src-1',
      source_metadata: { file_name: 'foo.md', frontmatter: { source_url: 'https://example.com' } },
    });
  });

  it('META: passes through frontmatter.content when present', async () => {
    const result = await documentToSaveInput(
      {
        id: 'meta-1',
        text: '{}',
        metadata: {
          file_name: 'config.json',
          frontmatter: { content: { max_users: 100, enabled: true } },
        },
      },
      { ...WIKI_DERIVERS },
    );
    expect(result.type).toBe('META');
    expect(result.content).toEqual({ max_users: 100, enabled: true });
  });

  it('META: passes through full frontmatter when no content field', async () => {
    const result = await documentToSaveInput(
      {
        id: 'meta-2',
        text: '{}',
        metadata: {
          file_name: 'config.json',
          frontmatter: { name: 'alice', role: 'admin' },
        },
      },
      { ...WIKI_DERIVERS },
    );
    expect(result.type).toBe('META');
    expect(result.content).toEqual({ name: 'alice', role: 'admin' });
  });

  it('META: falls back to metadata when no frontmatter at all', async () => {
    const result = await documentToSaveInput(
      { id: 'meta-3', text: '{}', metadata: { file_name: 'config.yaml', schema: 'v1' } },
      { ...WIKI_DERIVERS },
    );
    expect(result.type).toBe('META');
    expect(result.content).toMatchObject({ schema: 'v1' });
  });

  it('SUMMARY: leaves content undefined (text is in summary)', async () => {
    const result = await documentToSaveInput(
      {
        id: 'sum-1',
        text: '# Heading\n\nbody',
        metadata: { file_name: 'note.md' },
      },
      { ...WIKI_DERIVERS },
    );
    expect(result.type).toBe('SUMMARY');
    expect(result.content).toBeUndefined();
  });

  it('META content survives even when frontmatter.content is an array', async () => {
    const result = await documentToSaveInput(
      {
        id: 'meta-4',
        text: 'data',
        metadata: {
          file_name: 'list.json',
          frontmatter: { content: [1, 2, 3] },
        },
      },
      { ...WIKI_DERIVERS },
    );
    expect(result.type).toBe('META');
    expect(result.content).toEqual([1, 2, 3]);
  });
});
