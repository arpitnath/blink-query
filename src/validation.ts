import type { SaveInput, RecordType } from './types.js';

const VALID_TYPES: RecordType[] = ['SUMMARY', 'META', 'COLLECTION', 'SOURCE', 'ALIAS'];
const MAX_CONTENT_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TAGS = 100;

/**
 * Validates namespace format.
 * Rejects: #, ?, %, .., empty, whitespace-only, leading/trailing slashes
 */
export function validateNamespace(ns: string): void {
  if (typeof ns !== 'string') {
    throw new Error('Namespace is required and must be a string');
  }

  if (ns.length === 0) {
    throw new Error('Namespace cannot be empty');
  }

  const trimmed = ns.trim();
  if (trimmed.length === 0) {
    throw new Error('Namespace cannot be empty or whitespace-only');
  }

  if (trimmed !== ns) {
    throw new Error('Namespace cannot have leading or trailing whitespace');
  }

  if (ns.startsWith('/') || ns.endsWith('/')) {
    throw new Error('Namespace cannot start or end with a slash');
  }

  if (ns.includes('#')) {
    throw new Error('Namespace cannot contain # character');
  }

  if (ns.includes('?')) {
    throw new Error('Namespace cannot contain ? character');
  }

  if (ns.includes('%')) {
    throw new Error('Namespace cannot contain % character');
  }

  if (ns.includes('..')) {
    throw new Error('Namespace cannot contain .. (directory traversal)');
  }
}

/**
 * Validates title format.
 * Rejects: empty, whitespace-only
 */
export function validateTitle(title: string): void {
  if (typeof title !== 'string') {
    throw new Error('Title is required and must be a string');
  }

  if (title.length === 0) {
    throw new Error('Title cannot be empty');
  }

  const trimmed = title.trim();
  if (trimmed.length === 0) {
    throw new Error('Title cannot be empty or whitespace-only');
  }
}

/**
 * Validates TTL value.
 * Rejects: negative, NaN, > MAX_SAFE_INTEGER, 0 (since code uses `ttl || DEFAULT_TTL` which is falsy for 0)
 */
export function validateTTL(ttl: number | undefined): void {
  if (ttl === undefined) {
    return; // TTL is optional
  }

  if (typeof ttl !== 'number') {
    throw new Error('TTL must be a number');
  }

  if (Number.isNaN(ttl)) {
    throw new Error('TTL cannot be NaN');
  }

  if (ttl === 0) {
    throw new Error('TTL cannot be 0 (use undefined for default TTL instead)');
  }

  if (ttl < 0) {
    throw new Error('TTL cannot be negative');
  }

  if (ttl > Number.MAX_SAFE_INTEGER) {
    throw new Error(`TTL cannot exceed ${Number.MAX_SAFE_INTEGER}`);
  }
}

/**
 * Validates content size (when stringified).
 * Rejects: content > 10MB when stringified
 */
export function validateContentSize(content: unknown): void {
  if (content === undefined || content === null) {
    return; // Content is optional
  }

  const serialized = JSON.stringify(content);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');

  if (sizeBytes > MAX_CONTENT_SIZE) {
    throw new Error(
      `Content size (${(sizeBytes / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of ${MAX_CONTENT_SIZE / 1024 / 1024}MB`
    );
  }
}

/**
 * Validates tags array.
 * Deduplicates tags and rejects arrays > 100 tags.
 * Returns deduplicated tags.
 */
export function validateTags(tags: string[] | undefined): string[] {
  if (tags === undefined) {
    return [];
  }

  if (!Array.isArray(tags)) {
    throw new Error('Tags must be an array');
  }

  // Deduplicate
  const uniqueTags = [...new Set(tags)];

  if (uniqueTags.length > MAX_TAGS) {
    throw new Error(`Tags array cannot exceed ${MAX_TAGS} tags (found ${uniqueTags.length} after deduplication)`);
  }

  return uniqueTags;
}

/**
 * Validates record type.
 * Ensures type is one of: SUMMARY, META, COLLECTION, SOURCE, ALIAS
 */
export function validateRecordType(type: string | undefined): void {
  if (type === undefined) {
    return; // Type is optional (defaults to SUMMARY)
  }

  if (!VALID_TYPES.includes(type as RecordType)) {
    throw new Error(`Invalid record type: ${type}. Must be one of: ${VALID_TYPES.join(', ')}`);
  }
}

/**
 * Validates PostgreSQL WHERE clause to prevent SQL injection.
 * Rejects: semicolons, SQL comments, dangerous keywords
 */
export function validatePostgresWhere(where: string): void {
  if (!where || typeof where !== 'string') {
    return;
  }

  // Reject semicolons (statement terminator)
  if (where.includes(';')) {
    throw new Error('WHERE clause cannot contain semicolons');
  }

  // Reject SQL comments
  if (where.includes('--') || where.includes('/*') || where.includes('*/')) {
    throw new Error('WHERE clause cannot contain SQL comments');
  }

  // Reject dangerous keywords (case-insensitive)
  const dangerous = /\b(UNION|DROP|ALTER|CREATE|INSERT|UPDATE|DELETE|EXEC|EXECUTE|TRUNCATE|GRANT|REVOKE)\b/i;
  if (dangerous.test(where)) {
    throw new Error('WHERE clause contains dangerous SQL keywords');
  }
}

/**
 * Orchestrator validation function that validates all fields in SaveInput.
 * Returns a cleaned SaveInput with deduplicated tags.
 */
export function validateSaveInput(input: SaveInput): SaveInput {
  validateNamespace(input.namespace);
  validateTitle(input.title);
  validateRecordType(input.type);
  validateTTL(input.ttl);
  validateContentSize(input.content);
  const cleanedTags = validateTags(input.tags);

  // Return cleaned input with deduplicated tags
  return {
    ...input,
    tags: cleanedTags,
  };
}
