import { describe, it, expect } from 'vitest';
import {
  validateNamespace,
  validateTitle,
  validateTTL,
  validateContentSize,
  validateTags,
  validateRecordType,
  validatePostgresWhere,
  validateSaveInput,
} from '../src/validation.js';
import type { SaveInput } from '../src/types.js';

describe('validateNamespace', () => {
  it('accepts valid namespaces', () => {
    expect(() => validateNamespace('me')).not.toThrow();
    expect(() => validateNamespace('projects/orpheus')).not.toThrow();
    expect(() => validateNamespace('foo/bar/baz')).not.toThrow();
    expect(() => validateNamespace('my-namespace')).not.toThrow();
    expect(() => validateNamespace('namespace_with_underscore')).not.toThrow();
  });

  it('rejects empty namespace', () => {
    expect(() => validateNamespace('')).toThrow('Namespace cannot be empty');
  });

  it('rejects whitespace-only namespace', () => {
    expect(() => validateNamespace('   ')).toThrow('Namespace cannot be empty or whitespace-only');
  });

  it('rejects namespace with leading whitespace', () => {
    expect(() => validateNamespace(' me')).toThrow('Namespace cannot have leading or trailing whitespace');
  });

  it('rejects namespace with trailing whitespace', () => {
    expect(() => validateNamespace('me ')).toThrow('Namespace cannot have leading or trailing whitespace');
  });

  it('rejects namespace with leading slash', () => {
    expect(() => validateNamespace('/me')).toThrow('Namespace cannot start or end with a slash');
  });

  it('rejects namespace with trailing slash', () => {
    expect(() => validateNamespace('me/')).toThrow('Namespace cannot start or end with a slash');
  });

  it('rejects namespace with # character', () => {
    expect(() => validateNamespace('me#anchor')).toThrow('Namespace cannot contain # character');
  });

  it('rejects namespace with ? character', () => {
    expect(() => validateNamespace('me?query')).toThrow('Namespace cannot contain ? character');
  });

  it('rejects namespace with % character', () => {
    expect(() => validateNamespace('me%20space')).toThrow('Namespace cannot contain % character');
  });

  it('rejects namespace with .. (directory traversal)', () => {
    expect(() => validateNamespace('me/../etc')).toThrow('Namespace cannot contain .. (directory traversal)');
  });

  it('rejects non-string namespace', () => {
    expect(() => validateNamespace(null as any)).toThrow('Namespace is required and must be a string');
    expect(() => validateNamespace(undefined as any)).toThrow('Namespace is required and must be a string');
    expect(() => validateNamespace(123 as any)).toThrow('Namespace is required and must be a string');
  });
});

describe('validateTitle', () => {
  it('accepts valid titles', () => {
    expect(() => validateTitle('My Title')).not.toThrow();
    expect(() => validateTitle('A simple title')).not.toThrow();
    expect(() => validateTitle('Title with numbers 123')).not.toThrow();
  });

  it('rejects empty title', () => {
    expect(() => validateTitle('')).toThrow('Title cannot be empty');
  });

  it('rejects whitespace-only title', () => {
    expect(() => validateTitle('   ')).toThrow('Title cannot be empty or whitespace-only');
  });

  it('rejects non-string title', () => {
    expect(() => validateTitle(null as any)).toThrow('Title is required and must be a string');
    expect(() => validateTitle(undefined as any)).toThrow('Title is required and must be a string');
    expect(() => validateTitle(123 as any)).toThrow('Title is required and must be a string');
  });
});

describe('validateTTL', () => {
  it('accepts valid TTL values', () => {
    expect(() => validateTTL(100)).not.toThrow();
    expect(() => validateTTL(3600)).not.toThrow();
    expect(() => validateTTL(Number.MAX_SAFE_INTEGER)).not.toThrow();
  });

  it('accepts undefined TTL (optional)', () => {
    expect(() => validateTTL(undefined)).not.toThrow();
  });

  it('rejects TTL = 0', () => {
    expect(() => validateTTL(0)).toThrow('TTL cannot be 0');
  });

  it('rejects negative TTL', () => {
    expect(() => validateTTL(-100)).toThrow('TTL cannot be negative');
  });

  it('rejects NaN', () => {
    expect(() => validateTTL(NaN)).toThrow('TTL cannot be NaN');
  });

  it('rejects TTL > MAX_SAFE_INTEGER', () => {
    expect(() => validateTTL(Number.MAX_SAFE_INTEGER + 1)).toThrow('TTL cannot exceed');
  });

  it('rejects non-number TTL', () => {
    expect(() => validateTTL('100' as any)).toThrow('TTL must be a number');
  });
});

describe('validateContentSize', () => {
  it('accepts small content', () => {
    expect(() => validateContentSize({ foo: 'bar' })).not.toThrow();
    expect(() => validateContentSize('simple string')).not.toThrow();
    expect(() => validateContentSize([1, 2, 3])).not.toThrow();
  });

  it('accepts undefined/null content (optional)', () => {
    expect(() => validateContentSize(undefined)).not.toThrow();
    expect(() => validateContentSize(null)).not.toThrow();
  });

  it('rejects content > 10MB', () => {
    const largeContent = { data: 'x'.repeat(11 * 1024 * 1024) }; // 11MB
    expect(() => validateContentSize(largeContent)).toThrow('Content size');
    expect(() => validateContentSize(largeContent)).toThrow('exceeds maximum allowed size of 10MB');
  });

  it('accepts content just under 10MB', () => {
    const almostTooLarge = { data: 'x'.repeat(9 * 1024 * 1024) }; // 9MB
    expect(() => validateContentSize(almostTooLarge)).not.toThrow();
  });
});

describe('validateTags', () => {
  it('accepts valid tag arrays', () => {
    expect(validateTags(['tag1', 'tag2'])).toEqual(['tag1', 'tag2']);
    expect(validateTags(['foo'])).toEqual(['foo']);
  });

  it('accepts undefined tags (optional)', () => {
    expect(validateTags(undefined)).toEqual([]);
  });

  it('deduplicates tags', () => {
    expect(validateTags(['tag1', 'tag2', 'tag1'])).toEqual(['tag1', 'tag2']);
    expect(validateTags(['foo', 'foo', 'foo'])).toEqual(['foo']);
  });

  it('rejects arrays > 100 tags after deduplication', () => {
    const tooManyTags = Array.from({ length: 101 }, (_, i) => `tag${i}`);
    expect(() => validateTags(tooManyTags)).toThrow('Tags array cannot exceed 100 tags');
  });

  it('accepts exactly 100 unique tags', () => {
    const exactlyMaxTags = Array.from({ length: 100 }, (_, i) => `tag${i}`);
    expect(() => validateTags(exactlyMaxTags)).not.toThrow();
  });

  it('accepts > 100 tags if they deduplicate to ≤ 100', () => {
    // 101 total tags but only 50 unique
    const tags = [...Array(101)].map((_, i) => `tag${i % 50}`);
    const result = validateTags(tags);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('rejects non-array tags', () => {
    expect(() => validateTags('not-an-array' as any)).toThrow('Tags must be an array');
  });
});

describe('validateRecordType', () => {
  it('accepts all valid record types', () => {
    expect(() => validateRecordType('SUMMARY')).not.toThrow();
    expect(() => validateRecordType('META')).not.toThrow();
    expect(() => validateRecordType('COLLECTION')).not.toThrow();
    expect(() => validateRecordType('SOURCE')).not.toThrow();
    expect(() => validateRecordType('ALIAS')).not.toThrow();
  });

  it('accepts undefined type (optional, defaults to SUMMARY)', () => {
    expect(() => validateRecordType(undefined)).not.toThrow();
  });

  it('rejects invalid record types', () => {
    expect(() => validateRecordType('INVALID')).toThrow('Invalid record type: INVALID');
    expect(() => validateRecordType('summary')).toThrow('Invalid record type: summary'); // case-sensitive
    expect(() => validateRecordType('RECORD')).toThrow('Invalid record type: RECORD');
  });
});

describe('validatePostgresWhere', () => {
  it('accepts valid WHERE clauses', () => {
    expect(() => validatePostgresWhere('age > 18')).not.toThrow();
    expect(() => validatePostgresWhere('name = \'John\'')).not.toThrow();
    expect(() => validatePostgresWhere('status IN (\'active\', \'pending\')')).not.toThrow();
    expect(() => validatePostgresWhere('created_at >= \'2024-01-01\'')).not.toThrow();
  });

  it('accepts empty/undefined WHERE clause', () => {
    expect(() => validatePostgresWhere('')).not.toThrow();
    expect(() => validatePostgresWhere(undefined as any)).not.toThrow();
  });

  it('rejects WHERE clause with semicolons', () => {
    expect(() => validatePostgresWhere('age > 18; DROP TABLE users;')).toThrow('WHERE clause cannot contain semicolons');
  });

  it('rejects WHERE clause with SQL comments', () => {
    expect(() => validatePostgresWhere('age > 18 -- comment')).toThrow('WHERE clause cannot contain SQL comments');
    expect(() => validatePostgresWhere('age > 18 /* comment */')).toThrow('WHERE clause cannot contain SQL comments');
  });

  it('rejects WHERE clause with UNION', () => {
    expect(() => validatePostgresWhere('age > 18 UNION SELECT * FROM passwords')).toThrow('WHERE clause contains dangerous SQL keywords');
  });

  it('rejects WHERE clause with DROP', () => {
    expect(() => validatePostgresWhere('1=1 OR DROP TABLE users')).toThrow('WHERE clause contains dangerous SQL keywords');
  });

  it('rejects WHERE clause with ALTER', () => {
    expect(() => validatePostgresWhere('1=1 OR ALTER TABLE users')).toThrow('WHERE clause contains dangerous SQL keywords');
  });

  it('rejects WHERE clause with INSERT', () => {
    expect(() => validatePostgresWhere('1=1 OR INSERT INTO users')).toThrow('WHERE clause contains dangerous SQL keywords');
  });

  it('rejects WHERE clause with UPDATE', () => {
    expect(() => validatePostgresWhere('1=1 OR UPDATE users SET')).toThrow('WHERE clause contains dangerous SQL keywords');
  });

  it('rejects WHERE clause with DELETE', () => {
    expect(() => validatePostgresWhere('1=1 OR DELETE FROM users')).toThrow('WHERE clause contains dangerous SQL keywords');
  });

  it('is case-insensitive for dangerous keywords', () => {
    expect(() => validatePostgresWhere('age > 18 union select')).toThrow('WHERE clause contains dangerous SQL keywords');
    expect(() => validatePostgresWhere('age > 18 UnIoN sElEcT')).toThrow('WHERE clause contains dangerous SQL keywords');
  });
});

describe('validateSaveInput', () => {
  it('validates and cleans valid input', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: 'My Note',
      type: 'SUMMARY',
      summary: 'A simple note',
      tags: ['tag1', 'tag2'],
      ttl: 3600,
    };

    const result = validateSaveInput(input);
    expect(result).toEqual(input);
  });

  it('deduplicates tags in the result', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: 'My Note',
      tags: ['tag1', 'tag2', 'tag1', 'tag3', 'tag2'],
    };

    const result = validateSaveInput(input);
    expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
  });

  it('rejects input with invalid namespace', () => {
    const input: SaveInput = {
      namespace: '/invalid',
      title: 'My Note',
    };

    expect(() => validateSaveInput(input)).toThrow('Namespace cannot start or end with a slash');
  });

  it('rejects input with invalid title', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: '   ',
    };

    expect(() => validateSaveInput(input)).toThrow('Title cannot be empty or whitespace-only');
  });

  it('rejects input with invalid type', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: 'My Note',
      type: 'INVALID' as any,
    };

    expect(() => validateSaveInput(input)).toThrow('Invalid record type: INVALID');
  });

  it('rejects input with invalid TTL', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: 'My Note',
      ttl: -100,
    };

    expect(() => validateSaveInput(input)).toThrow('TTL cannot be negative');
  });

  it('rejects input with content too large', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: 'My Note',
      content: { data: 'x'.repeat(11 * 1024 * 1024) }, // 11MB
    };

    expect(() => validateSaveInput(input)).toThrow('Content size');
  });

  it('rejects input with too many tags', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: 'My Note',
      tags: Array.from({ length: 101 }, (_, i) => `tag${i}`),
    };

    expect(() => validateSaveInput(input)).toThrow('Tags array cannot exceed 100 tags');
  });

  it('accepts minimal valid input', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: 'My Note',
    };

    const result = validateSaveInput(input);
    expect(result.namespace).toBe('me');
    expect(result.title).toBe('My Note');
    expect(result.tags).toEqual([]);
  });

  it('accepts input with undefined optional fields', () => {
    const input: SaveInput = {
      namespace: 'me',
      title: 'My Note',
      type: undefined,
      summary: undefined,
      content: undefined,
      tags: undefined,
      ttl: undefined,
      sources: undefined,
    };

    const result = validateSaveInput(input);
    expect(result.tags).toEqual([]);
  });
});
