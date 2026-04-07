import { describe, it, expect, beforeEach } from 'vitest';
import { Blink } from '../src/blink.js';

function newBlink(): Blink {
  return new Blink({ dbPath: ':memory:' });
}

describe('Blink.createZone', () => {
  let blink: Blink;
  beforeEach(() => {
    blink = newBlink();
  });

  it('registers a zone with description, defaultTtl, and requiredTags', () => {
    const zone = blink.createZone({
      namespace: 'adr',
      description: 'Architecture decision records',
      defaultTtl: 86400 * 365,
      requiredTags: ['adr', 'status'],
    });

    expect(zone.path).toBe('adr');
    expect(zone.description).toBe('Architecture decision records');
    expect(zone.default_ttl).toBe(86400 * 365);
    expect(zone.required_tags).toEqual(['adr', 'status']);
  });

  it('only requires namespace; other fields default', () => {
    const zone = blink.createZone({ namespace: 'decisions' });
    expect(zone.path).toBe('decisions');
    expect(zone.description).toBeNull();
    expect(zone.required_tags).toBeNull();
    expect(zone.default_ttl).toBeGreaterThan(0);
  });

  it('strips deep namespaces to the top-level zone path', () => {
    const zone = blink.createZone({
      namespace: 'people/engineering/backend',
      description: 'people records',
    });
    expect(zone.path).toBe('people');
  });

  it('upserts metadata on repeat calls', () => {
    blink.createZone({
      namespace: 'adr',
      description: 'first',
      defaultTtl: 1000,
    });
    const updated = blink.createZone({
      namespace: 'adr',
      description: 'second',
      defaultTtl: 2000,
    });
    expect(updated.description).toBe('second');
    expect(updated.default_ttl).toBe(2000);
  });

  it('preserves unspecified fields on update', () => {
    blink.createZone({
      namespace: 'adr',
      description: 'original',
      requiredTags: ['adr'],
    });
    const updated = blink.createZone({
      namespace: 'adr',
      defaultTtl: 5000,
    });
    expect(updated.description).toBe('original');
    expect(updated.required_tags).toEqual(['adr']);
    expect(updated.default_ttl).toBe(5000);
  });
});

describe('Blink.getZone', () => {
  it('returns null for unregistered namespace', () => {
    const blink = newBlink();
    expect(blink.getZone('nonexistent')).toBeNull();
  });

  it('returns the zone when registered via createZone', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'adr', description: 'decisions' });
    expect(blink.getZone('adr')?.description).toBe('decisions');
  });

  it('returns the zone when auto-created via save (no metadata)', () => {
    const blink = newBlink();
    blink.save({ namespace: 'topics', title: 'foo', type: 'SUMMARY', summary: 'x' });
    const zone = blink.getZone('topics');
    expect(zone).not.toBeNull();
    expect(zone?.path).toBe('topics');
    expect(zone?.required_tags).toBeNull();
  });

  it('works with nested namespace inputs — returns the top-level zone', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'people', description: 'roster' });
    const zone = blink.getZone('people/alice/bio');
    expect(zone?.path).toBe('people');
  });
});

describe('save() applies zone defaultTtl', () => {
  it('uses zone defaultTtl when no TTL is specified on save', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'short-lived', defaultTtl: 60 });
    const record = blink.save({
      namespace: 'short-lived',
      title: 'foo',
      type: 'SUMMARY',
      summary: 'x',
    });
    expect(record.ttl).toBe(60);
  });

  it('an explicit save TTL overrides the zone defaultTtl', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'short-lived', defaultTtl: 60 });
    const record = blink.save({
      namespace: 'short-lived',
      title: 'foo',
      type: 'SUMMARY',
      summary: 'x',
      ttl: 9999,
    });
    expect(record.ttl).toBe(9999);
  });

  it('the hardcoded global default applies when no zone metadata exists', () => {
    const blink = newBlink();
    const record = blink.save({
      namespace: 'no-zone-config',
      title: 'foo',
      type: 'SUMMARY',
      summary: 'x',
    });
    // Default TTL is 30 days = 2592000 seconds
    expect(record.ttl).toBe(2592000);
  });
});

describe('save() enforces zone requiredTags', () => {
  it('allows save when all required tags are present', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'adr', requiredTags: ['adr', 'status'] });
    expect(() => {
      blink.save({
        namespace: 'adr',
        title: '001-use-sqlite',
        type: 'SUMMARY',
        summary: 'we use sqlite',
        tags: ['adr', 'status', 'accepted'],
      });
    }).not.toThrow();
  });

  it('throws when a required tag is missing', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'adr', requiredTags: ['adr', 'status'] });
    expect(() => {
      blink.save({
        namespace: 'adr',
        title: '001-use-sqlite',
        type: 'SUMMARY',
        summary: 'x',
        tags: ['adr'], // missing 'status'
      });
    }).toThrow(/status/);
  });

  it('error message lists missing tags', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'adr', requiredTags: ['a', 'b', 'c'] });
    try {
      blink.save({
        namespace: 'adr',
        title: 'foo',
        type: 'SUMMARY',
        summary: 'x',
        tags: ['a'],
      });
      throw new Error('should have thrown');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('b');
      expect(msg).toContain('c');
      expect(msg).not.toContain(' a,'); // 'a' was provided
    }
  });

  it('no-op when zone has no required tags', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'topics', description: 'anything goes' });
    expect(() => {
      blink.save({
        namespace: 'topics',
        title: 'foo',
        type: 'SUMMARY',
        summary: 'x',
      });
    }).not.toThrow();
  });

  it('requiredTags enforcement applies to nested namespaces under the zone', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'people', requiredTags: ['person'] });
    expect(() => {
      blink.save({
        namespace: 'people/engineering',
        title: 'alice',
        type: 'SUMMARY',
        summary: 'x',
      });
    }).toThrow(/person/);
  });
});

describe('Blink.zones() includes registered and auto-created zones', () => {
  it('lists registered zones alongside auto-created ones', () => {
    const blink = newBlink();
    blink.createZone({ namespace: 'adr', description: 'registered' });
    blink.save({ namespace: 'topics', title: 'foo', type: 'SUMMARY', summary: 'x' });

    const zones = blink.zones();
    const paths = zones.map(z => z.path).sort();
    expect(paths).toContain('adr');
    expect(paths).toContain('topics');
  });
});
