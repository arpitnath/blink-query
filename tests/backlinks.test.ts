import { describe, it, expect, beforeEach } from 'vitest';
import { Blink } from '../src/blink.js';
import { extractWikiLinks } from '../src/ingest.js';

function newBlink(): Blink {
  return new Blink({ dbPath: ':memory:' });
}

describe('backlinks', () => {
  let blink: Blink;
  beforeEach(() => {
    blink = newBlink();
  });

  it('returns ALIAS record in linked when wikilink is extracted', () => {
    const target = blink.save({ namespace: 'topics', title: 'product-launch', type: 'SUMMARY', summary: 'the product launch plan' });
    const source = blink.save({
      namespace: 'meetings',
      title: 'standup-monday',
      type: 'SUMMARY',
      summary: 'Discussed [[product-launch]] timeline with team.',
    });

    extractWikiLinks(blink, [source]);

    const result = blink.backlinks(target.path);
    expect(result.linked).toHaveLength(1);
    expect(result.linked[0].type).toBe('ALIAS');
    expect((result.linked[0].content as { target: string }).target).toBe(target.path);
  });

  it('returns multiple ALIASes pointing to the same target', () => {
    const target = blink.save({ namespace: 'topics', title: 'product-launch', type: 'SUMMARY', summary: 'launch plan' });
    const m1 = blink.save({
      namespace: 'meetings',
      title: 'meeting-1',
      type: 'SUMMARY',
      summary: 'Discussed [[product-launch]] timeline.',
    });
    const m2 = blink.save({
      namespace: 'meetings',
      title: 'meeting-2',
      type: 'SUMMARY',
      summary: '[[product-launch]] design spec delivered.',
    });

    extractWikiLinks(blink, [m1, m2]);

    const result = blink.backlinks(target.path);
    expect(result.linked).toHaveLength(2);
    expect(result.linked.every(r => r.type === 'ALIAS')).toBe(true);
  });

  it('returns empty arrays when no backlinks exist', () => {
    blink.save({ namespace: 'topics', title: 'orphan', type: 'SUMMARY', summary: 'nobody links here' });

    const result = blink.backlinks('topics/orphan');
    expect(result.linked).toEqual([]);
    expect(result.mentioned).toEqual([]);
  });

  it('does not return non-ALIAS records in linked', () => {
    const target = blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 'how transports work' });
    // Save a regular record that mentions transport in summary but is NOT an ALIAS
    blink.save({
      namespace: 'notes',
      title: 'note-about-transport',
      type: 'SOURCE',
      summary: 'some notes about transport layer',
    });

    const result = blink.backlinks(target.path);
    expect(result.linked).toEqual([]);
  });

  it('returns soft mentions in mentioned array', () => {
    const target = blink.save({ namespace: 'topics', title: 'product-launch', type: 'SUMMARY', summary: 'the launch plan' });
    // This record mentions "product-launch" in its summary but no wikilink was extracted
    blink.save({
      namespace: 'notes',
      title: 'random-note',
      type: 'SOURCE',
      summary: 'I was thinking about the product-launch timeline yesterday.',
    });

    const result = blink.backlinks(target.path);
    expect(result.linked).toEqual([]);
    expect(result.mentioned.length).toBeGreaterThanOrEqual(1);
    expect(result.mentioned[0].path).toBe('notes/random-note');
  });

  it('does not duplicate a record in both linked and mentioned', () => {
    const target = blink.save({ namespace: 'topics', title: 'transport', type: 'SUMMARY', summary: 'how transports work' });
    const source = blink.save({
      namespace: 'sources',
      title: 'mcp-spec',
      type: 'SUMMARY',
      summary: 'The transport layer is critical. See [[transport]] for details.',
    });

    extractWikiLinks(blink, [source]);

    const result = blink.backlinks(target.path);
    // The ALIAS should be in linked
    expect(result.linked).toHaveLength(1);
    // The source record mentions "transport" in summary but should not appear in mentioned
    // because mentioned excludes ALIAS records AND the source itself is not an ALIAS
    // The ALIAS is what shows up in linked; the source record may show in mentioned
    // but it's a distinct record from the ALIAS, so no duplication issue
    const mentionedPaths = result.mentioned.map(r => r.path);
    const linkedPaths = result.linked.map(r => r.path);
    // No path appears in both arrays
    for (const p of linkedPaths) {
      expect(mentionedPaths).not.toContain(p);
    }
  });

  it('excludes the target record itself from mentioned', () => {
    const target = blink.save({
      namespace: 'topics',
      title: 'transport',
      type: 'SUMMARY',
      summary: 'this page is about transport itself',
    });

    const result = blink.backlinks(target.path);
    expect(result.mentioned.map(r => r.path)).not.toContain(target.path);
  });

  it('returns empty mentioned when target path does not exist', () => {
    const result = blink.backlinks('nonexistent/path');
    expect(result.linked).toEqual([]);
    expect(result.mentioned).toEqual([]);
  });
});
