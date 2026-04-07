import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../src/ingest.js';

describe('parseFrontmatter', () => {
  it('parses a simple frontmatter block', () => {
    const text = `---
title: My Note
date: 2026-04-08
---
body here`;
    const r = parseFrontmatter(text)!;
    expect(r.frontmatter.title).toBe('My Note');
    expect(r.frontmatter.date).toBe('2026-04-08');
    expect(r.body).toBe('body here');
  });

  it('returns null when no frontmatter is present', () => {
    expect(parseFrontmatter('just body text')).toBeNull();
    expect(parseFrontmatter('# Heading\n\nbody')).toBeNull();
  });

  it('handles quoted values', () => {
    const text = `---
title: "Quoted title"
subtitle: 'single quoted'
---
body`;
    const r = parseFrontmatter(text)!;
    expect(r.frontmatter.title).toBe('Quoted title');
    expect(r.frontmatter.subtitle).toBe('single quoted');
  });

  it('coerces boolean, null, and numeric values', () => {
    const text = `---
published: true
draft: false
rating: 5
score: 4.2
notes: null
---
body`;
    const r = parseFrontmatter(text)!;
    expect(r.frontmatter.published).toBe(true);
    expect(r.frontmatter.draft).toBe(false);
    expect(r.frontmatter.rating).toBe(5);
    expect(r.frontmatter.score).toBe(4.2);
    expect(r.frontmatter.notes).toBeNull();
  });

  it('parses flat lists', () => {
    const text = `---
title: Test
tags:
  - mcp
  - protocol
  - spec
---
body`;
    const r = parseFrontmatter(text)!;
    expect(r.frontmatter.tags).toEqual(['mcp', 'protocol', 'spec']);
  });

  it('parses multiple lists in sequence', () => {
    const text = `---
tags:
  - a
  - b
authors:
  - alice
  - bob
---
body`;
    const r = parseFrontmatter(text)!;
    expect(r.frontmatter.tags).toEqual(['a', 'b']);
    expect(r.frontmatter.authors).toEqual(['alice', 'bob']);
  });

  it('returns null for unclosed frontmatter', () => {
    const text = `---
title: incomplete
body never terminates`;
    expect(parseFrontmatter(text)).toBeNull();
  });

  it('handles CRLF line endings', () => {
    const text = `---\r\ntitle: CRLF\r\n---\r\nbody`;
    const r = parseFrontmatter(text)!;
    expect(r.frontmatter.title).toBe('CRLF');
    expect(r.body).toBe('body');
  });

  it('strips the leading newline from the body', () => {
    const text = `---
title: x
---

body starts after blank line`;
    const r = parseFrontmatter(text)!;
    expect(r.body).toContain('body starts');
  });

  it('handles the real-world wiki source_url convention', () => {
    const text = `---
title: "MCP Transport Layer"
source_url: https://spec.modelcontextprotocol.io/
date: 2024-11-25
type: SOURCE
---

# MCP Transport Layer

body`;
    const r = parseFrontmatter(text)!;
    expect(r.frontmatter.title).toBe('MCP Transport Layer');
    expect(r.frontmatter.source_url).toBe('https://spec.modelcontextprotocol.io/');
    expect(r.frontmatter.type).toBe('SOURCE');
    expect(r.body).toContain('# MCP Transport Layer');
  });
});
