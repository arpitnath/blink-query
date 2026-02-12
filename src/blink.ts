import Database from 'better-sqlite3';
import { initDB, save, saveMany, getByPath, list, deleteRecord, move, searchByKeywords, listZones } from './store.js';
import { resolve } from './resolver.js';
import { executeQuery } from './query-executor.js';
import type { BlinkRecord, SaveInput, Zone, ResolveResponse } from './types.js';

export interface BlinkOptions {
  dbPath?: string;
}

export class Blink {
  private db: InstanceType<typeof Database>;

  constructor(options?: BlinkOptions) {
    this.db = initDB(options?.dbPath);
  }

  /** Save a knowledge record */
  save(input: SaveInput): BlinkRecord {
    return save(this.db, input);
  }

  /** Save multiple records in a single transaction */
  saveMany(inputs: SaveInput[]): BlinkRecord[] {
    return saveMany(this.db, inputs);
  }

  /** Resolve a path (follows ALIASes, auto-generates COLLECTIONs) */
  resolve(path: string): ResolveResponse {
    return resolve(this.db, path);
  }

  /** Search by space-separated keywords */
  search(keywords: string, namespace?: string, limit?: number): BlinkRecord[] {
    const kws = keywords.split(/\s+/).filter(Boolean);
    return searchByKeywords(this.db, kws, namespace, limit);
  }

  /** List records in a namespace */
  list(namespace: string, sort?: 'recent' | 'hits' | 'title'): BlinkRecord[] {
    return list(this.db, namespace, sort);
  }

  /** Execute a Blink query string */
  query(queryString: string): BlinkRecord[] {
    return executeQuery(this.db, queryString);
  }

  /** List all zones */
  zones(): Zone[] {
    return listZones(this.db);
  }

  /** Delete a record by path */
  delete(path: string): boolean {
    return deleteRecord(this.db, path);
  }

  /** Move a record from one path to another */
  move(fromPath: string, toPath: string): BlinkRecord | null {
    return move(this.db, fromPath, toPath);
  }

  /** Get a record by exact path (no resolution) */
  get(path: string): BlinkRecord | null {
    return getByPath(this.db, path);
  }

  /** Close the database connection */
  close(): void {
    this.db.close();
  }
}

// Re-export types for consumers
export type { BlinkRecord, SaveInput, Zone, ResolveResponse, RecordType, Source, QueryAST, QueryCondition } from './types.js';
