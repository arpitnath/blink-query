import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import { mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { BlinkRecord, SaveInput, Zone } from './types.js';

const DEFAULT_TTL = 2592000; // 30 days

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS records (
    id           TEXT PRIMARY KEY,
    path         TEXT UNIQUE NOT NULL,
    namespace    TEXT NOT NULL,
    title        TEXT NOT NULL,
    type         TEXT NOT NULL CHECK(type IN ('SUMMARY','META','COLLECTION','SOURCE','ALIAS')),
    summary      TEXT,
    content      TEXT,
    ttl          INTEGER NOT NULL DEFAULT ${DEFAULT_TTL},
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    tags         TEXT DEFAULT '[]',
    token_count  INTEGER DEFAULT 0,
    hit_count    INTEGER DEFAULT 0,
    last_hit     TEXT,
    sources      TEXT DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_records_namespace ON records(namespace);
CREATE INDEX IF NOT EXISTS idx_records_type ON records(type);
CREATE INDEX IF NOT EXISTS idx_records_updated ON records(updated_at);
CREATE INDEX IF NOT EXISTS idx_records_hits ON records(hit_count DESC);

CREATE TABLE IF NOT EXISTS zones (
    path          TEXT PRIMARY KEY,
    description   TEXT,
    default_ttl   INTEGER DEFAULT ${DEFAULT_TTL},
    record_count  INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_modified TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS keywords (
    keyword      TEXT NOT NULL,
    record_path  TEXT NOT NULL,
    PRIMARY KEY (keyword, record_path),
    FOREIGN KEY (record_path) REFERENCES records(path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_keywords_keyword ON keywords(keyword);
`;

// Stop words to filter from keyword extraction
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'and', 'but', 'or',
  'not', 'no', 'nor', 'so', 'yet', 'both', 'each', 'few', 'more',
  'most', 'other', 'some', 'such', 'than', 'too', 'very', 'just',
  'about', 'up', 'out', 'if', 'then', 'that', 'this', 'it', 'its',
]);

function slug(text: string): string {
  const result = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
    .replace(/^-|-$/g, '');

  if (!result) {
    // Fallback for emoji-only or special-char-only titles
    return `record-${Date.now().toString(36)}`;
  }
  return result;
}

function contentHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function tokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function now(): string {
  return new Date().toISOString();
}

function shortId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 8);
}

export function extractKeywords(record: { title: string; tags: string[]; summary: string | null }): string[] {
  const words: string[] = [];

  // From title
  words.push(...record.title.toLowerCase().split(/\W+/).filter(Boolean));

  // From tags
  words.push(...record.tags.map(t => t.toLowerCase().trim()).filter(Boolean));

  // From summary (top terms)
  if (record.summary) {
    words.push(...record.summary.toLowerCase().split(/\W+/).filter(Boolean));
  }

  // Deduplicate, filter stop words + short words
  const unique = [...new Set(words)].filter(w => w.length > 2 && !STOP_WORDS.has(w));
  return unique;
}

function getZonePath(namespace: string): string {
  // Top-level namespace: "me/background" -> "me"
  const parts = namespace.split('/');
  return parts[0];
}

// --- Database initialization ---

export function getDefaultDbPath(): string {
  const dir = join(homedir(), '.blink');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return join(dir, 'blink.db');
}

export function initDB(dbPath?: string): Database {
  const path = dbPath || getDefaultDbPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA);
  return db;
}

// --- Zone operations ---

function ensureZone(db: Database, namespace: string): void {
  const zonePath = getZonePath(namespace);
  const existing = db.prepare('SELECT path FROM zones WHERE path = ?').get(zonePath) as { path: string } | null;
  if (!existing) {
    const timestamp = now();
    db.prepare(
      'INSERT INTO zones (path, default_ttl, record_count, created_at, last_modified) VALUES (?, ?, 0, ?, ?)'
    ).run(zonePath, DEFAULT_TTL, timestamp, timestamp);
  }
}

function incrementZoneCount(db: Database, namespace: string, delta: number): void {
  const zonePath = getZonePath(namespace);
  db.prepare(
    'UPDATE zones SET record_count = record_count + ?, last_modified = ? WHERE path = ?'
  ).run(delta, now(), zonePath);
}

export function listZones(db: Database): Zone[] {
  const rows = db.prepare('SELECT * FROM zones ORDER BY path').all() as Zone[];
  return rows;
}

// --- Keyword operations ---

function indexKeywords(db: Database, recordPath: string, keywords: string[]): void {
  const stmt = db.prepare('INSERT OR IGNORE INTO keywords (keyword, record_path) VALUES (?, ?)');
  for (const keyword of keywords) {
    stmt.run(keyword, recordPath);
  }
}

function removeKeywords(db: Database, recordPath: string): void {
  db.prepare('DELETE FROM keywords WHERE record_path = ?').run(recordPath);
}

export function searchByKeywords(db: Database, keywords: string[], namespace?: string, limit = 10): BlinkRecord[] {
  const placeholders = keywords.map(() => '?').join(', ');
  let sql = `
    SELECT r.* FROM records r
    JOIN keywords k ON k.record_path = r.path
    WHERE k.keyword IN (${placeholders})
  `;
  const params: unknown[] = [...keywords.map(k => k.toLowerCase())];

  if (namespace) {
    sql += ' AND r.namespace LIKE ?';
    params.push(namespace + '%');
  }

  sql += ` GROUP BY r.path ORDER BY COUNT(DISTINCT k.keyword) DESC, r.hit_count DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(sql).all(...params) as RawRecord[];
  return rows.map(deserializeRecord);
}

// --- Record CRUD ---

interface RawRecord {
  id: string;
  path: string;
  namespace: string;
  title: string;
  type: string;
  summary: string | null;
  content: string | null;
  ttl: number;
  created_at: string;
  updated_at: string;
  content_hash: string;
  tags: string;
  token_count: number;
  hit_count: number;
  last_hit: string | null;
  sources: string;
}

function deserializeRecord(row: RawRecord): BlinkRecord {
  return {
    ...row,
    type: row.type as BlinkRecord['type'],
    content: row.content ? JSON.parse(row.content) : null,
    tags: JSON.parse(row.tags || '[]'),
    sources: JSON.parse(row.sources || '[]'),
  };
}

export function save(db: Database, input: SaveInput): BlinkRecord {
  const type = input.type || 'SUMMARY';

  // A5: Validate ALIAS content on save
  if (type === 'ALIAS') {
    const aliasContent = input.content as { target?: string } | null;
    if (!aliasContent?.target || typeof aliasContent.target !== 'string') {
      throw new Error('ALIAS records require content with a "target" string field');
    }
  }

  let path = input.namespace + '/' + slug(input.title);
  const tags = input.tags || [];
  const summary = input.summary || null;
  const content = input.content ? JSON.stringify(input.content) : null;
  const hash = contentHash(summary || content || '');
  const tokens = summary ? tokenCount(summary) : 0;
  const timestamp = now();
  const ttl = input.ttl || DEFAULT_TTL;
  const sources = input.sources ? JSON.stringify(input.sources) : '[]';

  // A2: Handle slug collisions — different titles producing the same slug
  let counter = 2;
  while (true) {
    const existing = db.prepare('SELECT id, title FROM records WHERE path = ?').get(path) as { id: string; title: string } | null;
    if (!existing) break;
    if (existing.title === input.title) break; // Same title = upsert
    path = input.namespace + '/' + slug(input.title) + `-${counter}`;
    counter++;
  }

  const doSave = db.transaction(() => {
    // Check for existing record at this path
    const existing = db.prepare('SELECT id FROM records WHERE path = ?').get(path) as { id: string } | null;

    if (existing) {
      // Update existing
      db.prepare(`
        UPDATE records SET
          title = ?, type = ?, summary = ?, content = ?, ttl = ?,
          updated_at = ?, content_hash = ?, tags = ?, token_count = ?,
          sources = ?
        WHERE path = ?
      `).run(input.title, type, summary, content, ttl, timestamp, hash, JSON.stringify(tags), tokens, sources, path);

      // Re-index keywords
      removeKeywords(db, path);
      const keywords = extractKeywords({ title: input.title, tags, summary });
      indexKeywords(db, path, keywords);
    } else {
      // Insert new
      const id = shortId();
      ensureZone(db, input.namespace);

      db.prepare(`
        INSERT INTO records (id, path, namespace, title, type, summary, content, ttl,
          created_at, updated_at, content_hash, tags, token_count, hit_count, last_hit, sources)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
      `).run(id, path, input.namespace, input.title, type, summary, content, ttl,
        timestamp, timestamp, hash, JSON.stringify(tags), tokens, sources);

      // Index keywords
      const keywords = extractKeywords({ title: input.title, tags, summary });
      indexKeywords(db, path, keywords);

      // Update zone count
      incrementZoneCount(db, input.namespace, 1);
    }
  });

  doSave();
  return getByPath(db, path)!;
}

export function getByPath(db: Database, path: string): BlinkRecord | null {
  const row = db.prepare('SELECT * FROM records WHERE path = ?').get(path) as RawRecord | null;
  if (!row) return null;
  return deserializeRecord(row);
}

export function list(db: Database, namespace: string, sort: 'recent' | 'hits' | 'title' = 'recent', limit?: number): BlinkRecord[] {
  // Normalize: remove trailing slash
  const ns = namespace.replace(/\/$/, '');

  const orderBy = sort === 'hits' ? 'hit_count DESC' : sort === 'title' ? 'title ASC' : 'updated_at DESC';

  let sql = `SELECT * FROM records WHERE namespace = ? OR namespace LIKE ? ORDER BY ${orderBy}`;
  const params: unknown[] = [ns, ns + '/%'];

  if (limit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

  const rows = db.prepare(sql).all(...params) as RawRecord[];
  return rows.map(deserializeRecord);
}

export function deleteRecord(db: Database, path: string): boolean {
  const record = getByPath(db, path);
  if (!record) return false;

  const doDelete = db.transaction(() => {
    removeKeywords(db, path);
    db.prepare('DELETE FROM records WHERE path = ?').run(path);
    incrementZoneCount(db, record.namespace, -1);
  });

  doDelete();
  return true;
}

export function move(db: Database, fromPath: string, toPath: string): BlinkRecord | null {
  const record = getByPath(db, fromPath);
  if (!record) return null;

  // Derive new namespace from toPath
  const parts = toPath.split('/');
  const newNamespace = parts.slice(0, -1).join('/');

  const doMove = db.transaction(() => {
    ensureZone(db, newNamespace);

    // Remove old keywords before path change (FK constraint)
    removeKeywords(db, fromPath);

    db.prepare('UPDATE records SET path = ?, namespace = ?, updated_at = ? WHERE path = ?')
      .run(toPath, newNamespace, now(), fromPath);
    const keywords = extractKeywords({ title: record.title, tags: record.tags, summary: record.summary });
    indexKeywords(db, toPath, keywords);

    // Update zone counts
    incrementZoneCount(db, record.namespace, -1);
    incrementZoneCount(db, newNamespace, 1);
  });

  doMove();
  return getByPath(db, toPath);
}

export function incrementHit(db: Database, path: string): void {
  db.prepare('UPDATE records SET hit_count = hit_count + 1, last_hit = ? WHERE path = ?')
    .run(now(), path);
}

export function saveMany(db: Database, inputs: SaveInput[]): BlinkRecord[] {
  const doSaveMany = db.transaction(() => {
    return inputs.map(input => save(db, input));
  });
  return doSaveMany();
}

// Query records by namespace prefix (for query executor)
export function queryRecords(
  db: Database,
  namespacePrefix: string,
  conditions: Array<{ field: string; op: string; value: string | number }>,
  orderBy?: { field: string; direction: string },
  limit?: number,
  since?: string
): BlinkRecord[] {
  const ALLOWED_FIELDS = new Set(['type', 'title', 'namespace', 'id', 'path', 'hit_count', 'token_count', 'ttl', 'created_at', 'updated_at']);

  let sql = 'SELECT * FROM records WHERE (namespace = ? OR namespace LIKE ?)';
  const params: unknown[] = [namespacePrefix, namespacePrefix + '/%'];

  // Handle since
  if (since) {
    sql += ' AND created_at >= ?';
    params.push(since);
  }

  // Handle WHERE conditions
  for (const cond of conditions) {
    if (cond.field === 'contains') {
      sql += ' AND summary LIKE ?';
      params.push(`%${cond.value}%`);
    } else if (cond.field === 'tag') {
      sql += ' AND EXISTS (SELECT 1 FROM keywords WHERE keyword = ? AND record_path = records.path)';
      params.push(String(cond.value).toLowerCase());
    } else if (!ALLOWED_FIELDS.has(cond.field)) {
      throw new Error(`Invalid query field: ${cond.field}`);
    } else if (['type', 'title', 'namespace', 'id', 'path'].includes(cond.field)) {
      sql += ` AND ${cond.field} ${cond.op} ?`;
      params.push(cond.value);
    } else if (['hit_count', 'token_count', 'ttl', 'created_at', 'updated_at'].includes(cond.field)) {
      sql += ` AND ${cond.field} ${cond.op} ?`;
      params.push(cond.field === 'created_at' || cond.field === 'updated_at' ? cond.value : Number(cond.value));
    }
  }

  // Order
  if (orderBy) {
    const allowedFields = ['hit_count', 'token_count', 'created_at', 'updated_at', 'title', 'ttl'];
    if (allowedFields.includes(orderBy.field)) {
      sql += ` ORDER BY ${orderBy.field} ${orderBy.direction === 'desc' ? 'DESC' : 'ASC'}`;
    }
  } else {
    sql += ' ORDER BY updated_at DESC';
  }

  // Limit
  sql += ' LIMIT ?';
  params.push(limit || 50);

  const rows = db.prepare(sql).all(...params) as RawRecord[];
  return rows.map(deserializeRecord);
}
