import { describe, it, expect } from 'vitest';
import { parseQuery } from '../src/query-executor.js';

describe('query parser', () => {
  it('parses simple resource query', () => {
    const ast = parseQuery('discoveries');
    expect(ast.resource).toBe('discoveries');
  });

  it('parses WHERE with single condition', () => {
    const ast = parseQuery("discoveries where tag='auth'");
    expect(ast.where).toEqual({ field: 'tag', op: '=', value: 'auth' });
  });

  it('parses WHERE with multiple AND conditions', () => {
    const ast = parseQuery("discoveries where tag='auth' and category='pattern'");
    expect(ast.where).toEqual({
      type: 'and',
      children: [
        { field: 'tag', op: '=', value: 'auth' },
        { field: 'category', op: '=', value: 'pattern' }
      ]
    });
  });

  it('parses all operators', () => {
    expect((parseQuery("x where a='b'").where as any).op).toBe('=');
    expect((parseQuery("x where a!='b'").where as any).op).toBe('!=');
    expect((parseQuery("x where a>5").where as any).op).toBe('>');
    expect((parseQuery("x where a<5").where as any).op).toBe('<');
    expect((parseQuery("x where a>=5").where as any).op).toBe('>=');
    expect((parseQuery("x where a<=5").where as any).op).toBe('<=');
    expect((parseQuery("x where a contains 'test'").where as any).op).toBe('contains');
  });

  it('parses ORDER BY', () => {
    const ast = parseQuery('discoveries order by hit_count desc');
    expect(ast.orderBy).toEqual({ field: 'hit_count', direction: 'desc' });
  });

  it('parses ORDER BY with default asc', () => {
    const ast = parseQuery('discoveries order by title');
    expect(ast.orderBy).toEqual({ field: 'title', direction: 'asc' });
  });

  it('parses LIMIT', () => {
    const ast = parseQuery('discoveries limit 5');
    expect(ast.limit).toBe(5);
  });

  it('parses SINCE', () => {
    const ast = parseQuery("sessions since '2026-02-01'");
    expect(ast.since).toBe('2026-02-01');
  });

  it('parses complex query with all clauses', () => {
    const ast = parseQuery("discoveries where tag='auth' and type='SUMMARY' order by hit_count desc limit 10");
    expect(ast.resource).toBe('discoveries');
    expect(ast.where).toEqual({
      type: 'and',
      children: [
        { field: 'tag', op: '=', value: 'auth' },
        { field: 'type', op: '=', value: 'SUMMARY' }
      ]
    });
    expect(ast.orderBy).toEqual({ field: 'hit_count', direction: 'desc' });
    expect(ast.limit).toBe(10);
  });

  it('is case-insensitive for keywords', () => {
    const ast1 = parseQuery("x WHERE a='b'");
    const ast2 = parseQuery("x where a='b'");
    const ast3 = parseQuery("x Where a='b'");
    expect(ast1.where).toEqual(ast2.where);
    expect(ast2.where).toEqual(ast3.where);
  });

  it('parses slashed namespace resource', () => {
    const ast = parseQuery('projects/orpheus');
    expect(ast.resource).toBe('projects/orpheus');
  });

  it('parses deeply nested namespace with clauses', () => {
    const ast = parseQuery("projects/orpheus/sessions where tag='auth'");
    expect(ast.resource).toBe('projects/orpheus/sessions');
    expect(ast.where).toEqual({ field: 'tag', op: '=', value: 'auth' });
  });

  it('throws on invalid syntax', () => {
    expect(() => parseQuery('??? invalid !!!')).toThrow();
  });

  // New tests for OR, IN, OFFSET
  it('parses OR operator', () => {
    const ast = parseQuery("ns where type='SUMMARY' or type='META'");
    expect(ast.where).toEqual({
      type: 'or',
      children: [
        { field: 'type', op: '=', value: 'SUMMARY' },
        { field: 'type', op: '=', value: 'META' }
      ]
    });
  });

  it('parses IN operator with multiple values', () => {
    const ast = parseQuery("ns where type in ('SUMMARY', 'META', 'SOURCE')");
    expect(ast.where).toEqual({
      field: 'type',
      op: 'in',
      value: ['SUMMARY', 'META', 'SOURCE']
    });
  });

  it('parses IN operator with single value', () => {
    const ast = parseQuery("ns where id in ('abc123')");
    expect(ast.where).toEqual({
      field: 'id',
      op: 'in',
      value: ['abc123']
    });
  });

  it('parses IN operator with numbers', () => {
    const ast = parseQuery("ns where hit_count in (5, 10, 15)");
    expect(ast.where).toEqual({
      field: 'hit_count',
      op: 'in',
      value: [5, 10, 15]
    });
  });

  it('parses OFFSET clause', () => {
    const ast = parseQuery('ns limit 10 offset 20');
    expect(ast.limit).toBe(10);
    expect(ast.offset).toBe(20);
  });

  it('parses OFFSET without LIMIT', () => {
    const ast = parseQuery('ns offset 5');
    expect(ast.offset).toBe(5);
  });

  it('respects AND/OR precedence (AND binds tighter)', () => {
    // a='1' and b='2' or c='3' should parse as: (a='1' and b='2') or c='3'
    const ast = parseQuery("ns where a='1' and b='2' or c='3'");
    expect(ast.where).toEqual({
      type: 'or',
      children: [
        {
          type: 'and',
          children: [
            { field: 'a', op: '=', value: '1' },
            { field: 'b', op: '=', value: '2' }
          ]
        },
        { field: 'c', op: '=', value: '3' }
      ]
    });
  });

  it('parses parentheses to override precedence', () => {
    // a='1' and (b='2' or c='3') should parse as: a='1' and (b='2' or c='3')
    const ast = parseQuery("ns where a='1' and (b='2' or c='3')");
    expect(ast.where).toEqual({
      type: 'and',
      children: [
        { field: 'a', op: '=', value: '1' },
        {
          type: 'or',
          children: [
            { field: 'b', op: '=', value: '2' },
            { field: 'c', op: '=', value: '3' }
          ]
        }
      ]
    });
  });

  it('parses complex nested expression', () => {
    const ast = parseQuery("ns where (a='1' or a='2') and (b='3' or b='4')");
    expect(ast.where).toEqual({
      type: 'and',
      children: [
        {
          type: 'or',
          children: [
            { field: 'a', op: '=', value: '1' },
            { field: 'a', op: '=', value: '2' }
          ]
        },
        {
          type: 'or',
          children: [
            { field: 'b', op: '=', value: '3' },
            { field: 'b', op: '=', value: '4' }
          ]
        }
      ]
    });
  });

  it('combines OR + IN + OFFSET', () => {
    const ast = parseQuery("ns where type in ('SUMMARY', 'META') or hit_count > 10 limit 5 offset 10");
    expect(ast.where).toEqual({
      type: 'or',
      children: [
        { field: 'type', op: 'in', value: ['SUMMARY', 'META'] },
        { field: 'hit_count', op: '>', value: 10 }
      ]
    });
    expect(ast.limit).toBe(5);
    expect(ast.offset).toBe(10);
  });

  // NOT operator tests
  it('parses NOT operator with single condition', () => {
    const ast = parseQuery("test where not type = 'META'");
    expect(ast.where).toEqual({
      type: 'not',
      child: { field: 'type', op: '=', value: 'META' }
    });
  });

  it('parses NOT with parenthesized group', () => {
    const ast = parseQuery("test where not (tag = 'draft' or tag = 'wip')");
    expect(ast.where).toEqual({
      type: 'not',
      child: {
        type: 'or',
        children: [
          { field: 'tag', op: '=', value: 'draft' },
          { field: 'tag', op: '=', value: 'wip' }
        ]
      }
    });
  });

  it('parses AND with NOT', () => {
    const ast = parseQuery("test where type = 'SUMMARY' and not tag = 'internal'");
    expect(ast.where).toEqual({
      type: 'and',
      children: [
        { field: 'type', op: '=', value: 'SUMMARY' },
        {
          type: 'not',
          child: { field: 'tag', op: '=', value: 'internal' }
        }
      ]
    });
  });

  it('parses double NOT', () => {
    const ast = parseQuery("test where not not type = 'META'");
    expect(ast.where).toEqual({
      type: 'not',
      child: {
        type: 'not',
        child: { field: 'type', op: '=', value: 'META' }
      }
    });
  });

  it('respects NOT precedence (NOT binds tighter than AND)', () => {
    // not a='1' and b='2' should parse as: (not a='1') and b='2'
    const ast = parseQuery("ns where not a='1' and b='2'");
    expect(ast.where).toEqual({
      type: 'and',
      children: [
        {
          type: 'not',
          child: { field: 'a', op: '=', value: '1' }
        },
        { field: 'b', op: '=', value: '2' }
      ]
    });
  });

  it('parses NOT with OR and AND', () => {
    const ast = parseQuery("ns where not type='META' or type='SOURCE' and tag='draft'");
    // Precedence: NOT > AND > OR
    // Should parse as: (not type='META') or (type='SOURCE' and tag='draft')
    expect(ast.where).toEqual({
      type: 'or',
      children: [
        {
          type: 'not',
          child: { field: 'type', op: '=', value: 'META' }
        },
        {
          type: 'and',
          children: [
            { field: 'type', op: '=', value: 'SOURCE' },
            { field: 'tag', op: '=', value: 'draft' }
          ]
        }
      ]
    });
  });
});
