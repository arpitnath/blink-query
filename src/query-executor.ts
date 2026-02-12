import type Database from 'better-sqlite3';
import type { BlinkRecord, QueryAST } from './types.js';
import { queryRecords } from './store.js';
// @ts-ignore — generated file
import { parse } from './grammar/query-parser.js';

export function parseQuery(queryString: string): QueryAST {
  return parse(queryString);
}

export function executeQuery(db: Database, queryString: string): BlinkRecord[] {
  const ast = parseQuery(queryString);

  return queryRecords(
    db,
    ast.resource,
    ast.where || [],
    ast.orderBy,
    ast.limit,
    ast.since
  );
}
