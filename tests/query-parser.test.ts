import { describe, it, expect } from 'vitest';
import { parseQuery } from '../src/query-executor.js';

describe('query parser', () => {
  it('parses simple resource query', () => {
    const ast = parseQuery('discoveries');
    expect(ast.resource).toBe('discoveries');
  });

  it('parses WHERE with single condition', () => {
    const ast = parseQuery("discoveries where tag='auth'");
    expect(ast.where).toHaveLength(1);
    expect(ast.where![0]).toEqual({ field: 'tag', op: '=', value: 'auth' });
  });

  it('parses WHERE with multiple AND conditions', () => {
    const ast = parseQuery("discoveries where tag='auth' and category='pattern'");
    expect(ast.where).toHaveLength(2);
    expect(ast.where![0].field).toBe('tag');
    expect(ast.where![1].field).toBe('category');
  });

  it('parses all operators', () => {
    expect(parseQuery("x where a='b'").where![0].op).toBe('=');
    expect(parseQuery("x where a!='b'").where![0].op).toBe('!=');
    expect(parseQuery("x where a>5").where![0].op).toBe('>');
    expect(parseQuery("x where a<5").where![0].op).toBe('<');
    expect(parseQuery("x where a>=5").where![0].op).toBe('>=');
    expect(parseQuery("x where a<=5").where![0].op).toBe('<=');
    expect(parseQuery("x where a contains 'test'").where![0].op).toBe('contains');
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
    expect(ast.where).toHaveLength(2);
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
    expect(ast.where).toHaveLength(1);
  });

  it('throws on invalid syntax', () => {
    expect(() => parseQuery('??? invalid !!!')).toThrow();
  });
});
