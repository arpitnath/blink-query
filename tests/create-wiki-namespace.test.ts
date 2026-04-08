import { describe, it, expect } from 'vitest';
import { createWikiNamespace, wikiNamespace } from '../src/ingest.js';

describe('createWikiNamespace factory', () => {
  it('routes files under a custom top-level directory', () => {
    const ns = createWikiNamespace({
      decisions: 'decisions/{dir}',
    });
    expect(ns({ file_path: 'decisions/2026-04/0001-use-sqlite.md' })).toBe('decisions/2026-04');
  });

  it('supports a literal template with no placeholders', () => {
    const ns = createWikiNamespace({
      adr: 'adr',
    });
    expect(ns({ file_path: 'adr/0001-use-sqlite.md' })).toBe('adr');
  });

  it('slugifies via {slug(dir)}', () => {
    const ns = createWikiNamespace({
      people: 'people/{slug(dir)}',
    });
    expect(ns({ file_path: 'people/Alice Smith/bio.md' })).toBe('people/alice-smith');
  });

  it('falls back to wikiNamespace for unmatched top-level directories', () => {
    const ns = createWikiNamespace({
      decisions: 'decisions/{dir}',
    });
    // sources/ is a built-in, decisions is custom
    expect(ns({ file_path: 'sources/foo.md' })).toBe(wikiNamespace({ file_path: 'sources/foo.md' }));
    expect(ns({ file_path: 'entity/alice/bio.md' })).toBe(wikiNamespace({ file_path: 'entity/alice/bio.md' }));
  });

  it('respects frontmatter namespace override', () => {
    const ns = createWikiNamespace({ decisions: 'decisions/{dir}' });
    expect(
      ns({
        file_path: 'decisions/2026/foo.md',
        frontmatter: { namespace: 'override/path' },
      }),
    ).toBe('override/path');
  });

  it('handles missing file_path gracefully (falls through to wikiNamespace)', () => {
    const ns = createWikiNamespace({ adr: 'adr' });
    expect(ns({})).toBe(wikiNamespace({}));
  });

  it('handles windows-style backslash paths', () => {
    const ns = createWikiNamespace({ decisions: 'decisions/{dir}' });
    expect(ns({ file_path: 'decisions\\2026-04\\foo.md' })).toBe('decisions/2026-04');
  });

  it('strips leading ./', () => {
    const ns = createWikiNamespace({ adr: 'adr' });
    expect(ns({ file_path: './adr/0001.md' })).toBe('adr');
  });

  it('when a custom pattern matches but the path has no nested dir, falls back to top dir', () => {
    const ns = createWikiNamespace({ adr: 'adr/{dir}' });
    // adr/0001.md — only top dir + file, no intermediate directory
    expect(ns({ file_path: 'adr/0001.md' })).toBe('adr/adr');
  });

  it('multiple custom patterns all work independently', () => {
    const ns = createWikiNamespace({
      decisions: 'decisions/{dir}',
      adr: 'adr',
      people: 'people/{slug(dir)}',
    });
    expect(ns({ file_path: 'decisions/q1/0001.md' })).toBe('decisions/q1');
    expect(ns({ file_path: 'adr/0001.md' })).toBe('adr');
    expect(ns({ file_path: 'people/Bob Jones/bio.md' })).toBe('people/bob-jones');
    expect(ns({ file_path: 'sources/foo.md' })).toBe('sources');
  });
});
