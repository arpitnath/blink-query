import Database from 'better-sqlite3';
import { createHash, randomUUID } from 'crypto';
import { mkdirSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { BlinkRecord, SaveInput, Zone, ZoneConfig } from './types.js';
import { validateSaveInput } from './validation.js';

/** Raw row shape of a zones table entry as returned by SQLite. */
interface RawZone {
  path: string;
  description: string | null;
  default_ttl: number;
  required_tags: string | null;
  record_count: number;
  created_at: string;
  last_modified: string;
}

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
    required_tags TEXT,
    record_count  INTEGER DEFAULT 0,
    created_at    TEXT NOT NULL,
    last_modified TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
    record_path UNINDEXED,
    title,
    tags,
    summary,
    tokenize='porter unicode61'
);
`;


export function slug(text: string): string {
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
  // 16 hex chars = 64 bits. Birthday-collision threshold ~4 billion records.
  // The previous 8-char (32-bit) id collided in practice on corpora >10k records.
  return randomUUID().replace(/-/g, '').slice(0, 16);
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
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000');
  db.pragma('mmap_size = 268435456');
  db.pragma('temp_store = MEMORY');
  migrateFTS(db);
  migrateZonesRequiredTags(db);
  return db;
}

/**
 * Migration: add `required_tags` column to zones table for databases
 * created before v2.0.0. Idempotent — no-op if the column already exists.
 */
export function migrateZonesRequiredTags(db: Database): void {
  const cols = db.prepare(`PRAGMA table_info(zones)`).all() as Array<{ name: string }>;
  if (cols.some(c => c.name === 'required_tags')) return;
  db.exec(`ALTER TABLE zones ADD COLUMN required_tags TEXT`);
}

export function migrateFTS(db: Database): void {
  // Check if old keywords table exists — migrate and drop it
  const hasKeywords = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='keywords'").get();
  if (hasKeywords) {
    db.exec('DROP TABLE IF EXISTS keywords');
  }

  // Only rebuild FTS if it's empty but records exist (first run or migration)
  const ftsCount = (db.prepare('SELECT COUNT(*) as cnt FROM records_fts').get() as { cnt: number }).cnt;
  const recordCount = (db.prepare('SELECT COUNT(*) as cnt FROM records').get() as { cnt: number }).cnt;

  if (ftsCount > 0 || recordCount === 0) return;

  // Rebuild FTS index from existing records
  const records = db.prepare('SELECT path, title, tags, summary FROM records').all() as any[];
  const insertFTS = db.prepare('INSERT INTO records_fts (record_path, title, tags, summary) VALUES (?, ?, ?, ?)');

  const doMigrate = db.transaction(() => {
    for (const r of records) {
      const tags = JSON.parse(r.tags || '[]').join(' ');
      insertFTS.run(r.path, r.title, tags, r.summary || '');
    }
  });
  doMigrate();
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

function deserializeZone(row: RawZone): Zone {
  return {
    path: row.path,
    description: row.description,
    default_ttl: row.default_ttl,
    required_tags: row.required_tags ? JSON.parse(row.required_tags) as string[] : null,
    record_count: row.record_count,
    created_at: row.created_at,
    last_modified: row.last_modified,
  };
}

export function listZones(db: Database): Zone[] {
  const rows = db.prepare('SELECT * FROM zones ORDER BY path').all() as RawZone[];
  return rows.map(deserializeZone);
}

export function getZone(db: Database, namespace: string): Zone | null {
  const zonePath = getZonePath(namespace);
  const row = db.prepare('SELECT * FROM zones WHERE path = ?').get(zonePath) as RawZone | null;
  return row ? deserializeZone(row) : null;
}

/**
 * Create or update a zone's metadata. Unlike ensureZone (which is called
 * implicitly on save), this lets devs and agents declare zones up-front with
 * a description, default TTL, and required tags that every record in the
 * zone must carry.
 */
export function createZone(db: Database, config: ZoneConfig): Zone {
  const zonePath = getZonePath(config.namespace);
  const timestamp = now();
  const existing = db.prepare('SELECT * FROM zones WHERE path = ?').get(zonePath) as RawZone | null;

  const description = config.description ?? existing?.description ?? null;
  const defaultTtl = config.defaultTtl ?? existing?.default_ttl ?? DEFAULT_TTL;
  const requiredTags = config.requiredTags !== undefined
    ? JSON.stringify(config.requiredTags)
    : existing?.required_tags ?? null;

  if (existing) {
    db.prepare(
      'UPDATE zones SET description = ?, default_ttl = ?, required_tags = ?, last_modified = ? WHERE path = ?'
    ).run(description, defaultTtl, requiredTags, timestamp, zonePath);
  } else {
    db.prepare(
      'INSERT INTO zones (path, description, default_ttl, required_tags, record_count, created_at, last_modified) VALUES (?, ?, ?, ?, 0, ?, ?)'
    ).run(zonePath, description, defaultTtl, requiredTags, timestamp, timestamp);
  }

  return getZone(db, config.namespace)!;
}

// --- FTS5 operations ---

function indexFTS(db: Database, recordPath: string, title: string, tags: string[], summary: string | null): void {
  // Remove existing entry first (for upserts)
  db.prepare('DELETE FROM records_fts WHERE record_path = ?').run(recordPath);
  db.prepare('INSERT INTO records_fts (record_path, title, tags, summary) VALUES (?, ?, ?, ?)')
    .run(recordPath, title, tags.join(' '), summary || '');
}

function removeFTS(db: Database, recordPath: string): void {
  db.prepare('DELETE FROM records_fts WHERE record_path = ?').run(recordPath);
}

export function searchByKeywords(db: Database, keywords: string[], namespace?: string, limit = 10, offset = 0): BlinkRecord[] {
  if (keywords.length === 0) return [];

  // Cap keywords to prevent excessive FTS5 expressions
  const kws = keywords.slice(0, 50);

  // Build FTS5 MATCH query: "word1 OR word2 OR word3"
  const matchExpr = kws.map(k => `"${k.replace(/"/g, '""')}"`).join(' OR ');

  // Universal title-weighted BM25 with type-aware boost.
  //
  // Per-column weights: title 10.0, tags 4.0, summary 1.0. The FTS5 records_fts
  // virtual table indexes (title, tags, summary) — record_path is UNINDEXED so
  // it's skipped. A title match contributes ~10x what a body summary match does.
  // This is the universal pattern across Pagefind (5x), Quartz, Meilisearch,
  // and the BM25F literature (3-10x is the empirical sweet spot). It's the
  // single highest-leverage corpus-agnostic ranking change.
  //
  // Type-aware offset: SUMMARY records (canonical "what is X" pages) get the
  // largest boost. SQLite's bm25() returns NEGATIVE values where lower = better,
  // so we ADD a negative offset per type to push canonical records up the rank.
  let sql = `
    SELECT r.*,
      bm25(records_fts, 10.0, 4.0, 1.0) + CASE r.type
        WHEN 'SUMMARY' THEN -2.0
        WHEN 'META' THEN -1.0
        WHEN 'COLLECTION' THEN -0.5
        ELSE 0.0
      END AS rank
    FROM records_fts fts
    JOIN records r ON r.path = fts.record_path
    WHERE records_fts MATCH ?
  `;
  const params: unknown[] = [matchExpr];

  if (namespace) {
    sql += ' AND r.namespace LIKE ?';
    params.push(namespace + '%');
  }

  sql += ' ORDER BY rank LIMIT ?';
  params.push(limit);

  if (offset > 0) {
    sql += ' OFFSET ?';
    params.push(offset);
  }

  const rows = db.prepare(sql).all(...params) as any[];
  return rows.map(row => {
    // Remove the rank field before deserializing
    const { rank, ...recordRow } = row;
    return deserializeRecord(recordRow);
  });
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

/**
 * Internal save logic without transaction wrapper.
 * Used by both save() and saveMany() to avoid nested transactions.
 */
function saveInner(db: Database, input: SaveInput): string {
  // Validate and clean input at the boundary
  const cleanedInput = validateSaveInput(input);
  const type = cleanedInput.type || 'SUMMARY';

  // A5: Validate ALIAS content on save
  if (type === 'ALIAS') {
    const aliasContent = cleanedInput.content as { target?: string } | null;
    if (!aliasContent?.target || typeof aliasContent.target !== 'string') {
      throw new Error('ALIAS records require content with a "target" string field');
    }
  }

  let path = cleanedInput.namespace + '/' + slug(cleanedInput.title);
  const tags = cleanedInput.tags || [];
  const summary = cleanedInput.summary || null;
  const content = cleanedInput.content ? JSON.stringify(cleanedInput.content) : null;
  const hash = contentHash(summary || content || '');
  const tokens = summary ? tokenCount(summary) : 0;
  const timestamp = now();
  const sources = cleanedInput.sources ? JSON.stringify(cleanedInput.sources) : '[]';

  // Zone metadata: apply defaultTtl and validate requiredTags.
  // Registered zones (via createZone) get first dibs on policy.
  const zone = getZone(db, cleanedInput.namespace);
  if (zone?.required_tags && zone.required_tags.length > 0) {
    const missing = zone.required_tags.filter(t => !tags.includes(t));
    if (missing.length > 0) {
      throw new Error(
        `Zone "${getZonePath(cleanedInput.namespace)}" requires tags [${zone.required_tags.join(', ')}], ` +
        `missing: [${missing.join(', ')}]`,
      );
    }
  }
  const ttl = cleanedInput.ttl || zone?.default_ttl || DEFAULT_TTL;

  // A2: Handle slug collisions — different titles producing the same slug
  let counter = 2;
  while (true) {
    const existing = db.prepare('SELECT id, title FROM records WHERE path = ?').get(path) as { id: string; title: string } | null;
    if (!existing) break;
    if (existing.title === cleanedInput.title) break; // Same title = upsert
    path = cleanedInput.namespace + '/' + slug(cleanedInput.title) + `-${counter}`;
    counter++;
  }

  // Check for existing record at this path
  const existing = db.prepare('SELECT id, content_hash FROM records WHERE path = ?').get(path) as { id: string; content_hash: string } | null;

  if (existing) {
    // Skip update if content hasn't changed
    if (cleanedInput.skipIfUnchanged && existing.content_hash === hash) {
      return path; // No-op — content unchanged
    }

    // Update existing
    db.prepare(`
      UPDATE records SET
        title = ?, type = ?, summary = ?, content = ?, ttl = ?,
        updated_at = ?, content_hash = ?, tags = ?, token_count = ?,
        sources = ?
      WHERE path = ?
    `).run(input.title, type, summary, content, ttl, timestamp, hash, JSON.stringify(tags), tokens, sources, path);

    // Re-index FTS
    indexFTS(db, path, input.title, tags, summary);
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

    // Index FTS
    indexFTS(db, path, input.title, tags, summary);

    // Update zone count
    incrementZoneCount(db, input.namespace, 1);
  }

  return path;
}

export function save(db: Database, input: SaveInput): BlinkRecord {
  const doSave = db.transaction(() => saveInner(db, input));
  const path = doSave();
  return getByPath(db, path)!;
}

export function getByPath(db: Database, path: string): BlinkRecord | null {
  const row = db.prepare('SELECT * FROM records WHERE path = ?').get(path) as RawRecord | null;
  if (!row) return null;
  return deserializeRecord(row);
}

export function list(db: Database, namespace: string, sort: 'recent' | 'hits' | 'title' = 'recent', limit?: number, offset?: number): BlinkRecord[] {
  // Normalize: remove trailing slash
  const ns = namespace.replace(/\/$/, '');

  const orderBy = sort === 'hits' ? 'hit_count DESC' : sort === 'title' ? 'title ASC' : 'updated_at DESC';

  let sql = `SELECT * FROM records WHERE namespace = ? OR namespace LIKE ? ORDER BY ${orderBy}`;
  const params: unknown[] = [ns, ns + '/%'];

  // SQLite requires LIMIT before OFFSET, so if offset is provided without limit, use -1 (unlimited)
  if (limit || (offset && offset > 0)) {
    sql += ' LIMIT ?';
    params.push(limit || -1);
  }

  if (offset && offset > 0) {
    sql += ' OFFSET ?';
    params.push(offset);
  }

  const rows = db.prepare(sql).all(...params) as RawRecord[];
  return rows.map(deserializeRecord);
}

export function deleteRecord(db: Database, path: string): boolean {
  const record = getByPath(db, path);
  if (!record) return false;

  const doDelete = db.transaction(() => {
    removeFTS(db, path);
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

    // Remove old FTS entry before path change
    removeFTS(db, fromPath);

    db.prepare('UPDATE records SET path = ?, namespace = ?, updated_at = ? WHERE path = ?')
      .run(toPath, newNamespace, now(), fromPath);
    indexFTS(db, toPath, record.title, record.tags, record.summary);

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
    return inputs.map(input => saveInner(db, input));
  });
  const paths = doSaveMany();
  return paths.map(path => getByPath(db, path)!);
}

export function countByNamespace(db: Database, ns: string): number {
  const row = db.prepare('SELECT COUNT(*) as c FROM records WHERE namespace = ?').get(ns) as { c: number };
  return row.c;
}

/**
 * Evict records that have exceeded their TTL.
 * Only records with ttl > 0 are eligible; ttl=0 means "never expire".
 * Returns the number of records deleted.
 */
export function evictStale(db: Database): number {
  const staleRecords = db.prepare(`
    SELECT path, namespace FROM records
    WHERE ttl > 0 AND (unixepoch('now') - unixepoch(updated_at)) > ttl
  `).all() as Array<{ path: string; namespace: string }>;

  if (staleRecords.length === 0) return 0;

  const doEvict = db.transaction(() => {
    for (const record of staleRecords) {
      db.prepare('DELETE FROM records_fts WHERE record_path = ?').run(record.path);
      db.prepare('DELETE FROM records WHERE path = ?').run(record.path);
      incrementZoneCount(db, record.namespace, -1);
    }
  });
  doEvict();

  return staleRecords.length;
}

export function findSuggestions(db: Database, pathPrefix: string, parentNs: string): Array<{ path: string; title: string; type: string }> {
  return db.prepare(
    'SELECT path, title, type FROM records WHERE path LIKE ? OR namespace = ? ORDER BY hit_count DESC LIMIT 5'
  ).all(pathPrefix + '%', parentNs) as Array<{ path: string; title: string; type: string }>;
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
      sql += ' AND EXISTS (SELECT 1 FROM records_fts WHERE records_fts MATCH ? AND record_path = records.path)';
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
