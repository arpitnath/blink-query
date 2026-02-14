import type Database from 'better-sqlite3';
import type { BlinkRecord, QueryAST, WhereExpr, QueryCondition } from './types.js';
// @ts-ignore — generated file
import { parse } from './grammar/query-parser.js';

export function parseQuery(queryString: string): QueryAST {
  return parse(queryString);
}

export function executeQuery(db: Database, queryString: string): BlinkRecord[] {
  const ast = parseQuery(queryString);
  return buildAndExecuteQuery(db, ast);
}

function buildAndExecuteQuery(db: Database, ast: QueryAST): BlinkRecord[] {
  const ALLOWED_FIELDS = new Set([
    'type', 'title', 'namespace', 'id', 'path',
    'hit_count', 'token_count', 'ttl', 'created_at', 'updated_at'
  ]);

  let sql = 'SELECT * FROM records WHERE (namespace = ? OR namespace LIKE ?)';
  const params: unknown[] = [ast.resource, ast.resource + '/%'];

  // Handle since clause
  if (ast.since) {
    sql += ' AND created_at >= ?';
    params.push(ast.since);
  }

  // Handle WHERE expression tree
  if (ast.where) {
    const whereSql = whereExprToSQL(ast.where, params, ALLOWED_FIELDS);
    sql += ` AND ${whereSql}`;
  }

  // Handle ORDER BY
  if (ast.orderBy) {
    const allowedOrderFields = ['hit_count', 'token_count', 'created_at', 'updated_at', 'title', 'ttl'];
    if (allowedOrderFields.includes(ast.orderBy.field)) {
      sql += ` ORDER BY ${ast.orderBy.field} ${ast.orderBy.direction === 'desc' ? 'DESC' : 'ASC'}`;
    }
  } else {
    sql += ' ORDER BY updated_at DESC';
  }

  // Handle LIMIT
  sql += ' LIMIT ?';
  params.push(ast.limit || 50);

  // Handle OFFSET
  if (ast.offset !== undefined && ast.offset > 0) {
    sql += ' OFFSET ?';
    params.push(ast.offset);
  }

  const stmt = db.prepare(sql);
  const rows = stmt.all(...params) as unknown[];
  return rows.map(deserializeRecord);
}

function whereExprToSQL(
  expr: WhereExpr,
  params: unknown[],
  allowedFields: Set<string>
): string {
  // Handle NOT node
  if ('type' in expr && expr.type === 'not') {
    const inner = whereExprToSQL((expr as any).child, params, allowedFields);
    return `NOT (${inner})`;
  }

  // Handle AND/OR nodes
  if ('type' in expr && (expr.type === 'and' || expr.type === 'or')) {
    const parts = expr.children.map(child => whereExprToSQL(child, params, allowedFields));
    const op = expr.type === 'and' ? ' AND ' : ' OR ';
    return `(${parts.join(op)})`;
  }

  // Handle leaf condition
  return conditionToSQL(expr as QueryCondition, params, allowedFields);
}

function conditionToSQL(
  cond: QueryCondition,
  params: unknown[],
  allowedFields: Set<string>
): string {
  // Special handling for 'contains' (LIKE search on summary)
  if (cond.field === 'contains') {
    params.push(`%${cond.value}%`);
    return 'summary LIKE ?';
  }

  // Special handling for 'tag' (keyword search)
  if (cond.field === 'tag') {
    params.push(String(cond.value).toLowerCase());
    return 'EXISTS (SELECT 1 FROM records_fts WHERE records_fts MATCH ? AND record_path = records.path)';
  }

  // Validate field
  if (!allowedFields.has(cond.field)) {
    throw new Error(`Invalid query field: ${cond.field}`);
  }

  // Handle IN operator
  if (cond.op === 'in') {
    const values = Array.isArray(cond.value) ? cond.value : [cond.value];
    const placeholders = values.map(() => '?').join(', ');
    values.forEach(v => params.push(v));
    return `${cond.field} IN (${placeholders})`;
  }

  // Handle standard operators
  const field = cond.field;
  const op = cond.op;
  const value = cond.value;

  // Type coercion for numeric/date fields
  if (['hit_count', 'token_count', 'ttl'].includes(field)) {
    params.push(Number(value));
  } else {
    params.push(value);
  }

  return `${field} ${op} ?`;
}

function deserializeRecord(row: any): BlinkRecord {
  return {
    ...row,
    tags: JSON.parse(row.tags || '[]'),
    sources: JSON.parse(row.sources || '[]'),
    content: row.content ? JSON.parse(row.content) : null,
  };
}
