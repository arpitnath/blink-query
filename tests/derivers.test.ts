import { describe, it, expect } from 'vitest';
import {
  POSTGRES_DERIVERS,
  postgresNamespace, postgresTitle, postgresTags, postgresSources,
  WEB_DERIVERS,
  webNamespace, webTitle, webTags, webSources,
  GIT_DERIVERS,
  gitNamespace, gitTitle, gitTags, gitSources,
} from '../src/ingest.js';

// ─── POSTGRES_DERIVERS ──────────────────────────────────────

describe('POSTGRES_DERIVERS', () => {
  it('has the correct shape', () => {
    expect(POSTGRES_DERIVERS.deriveNamespace).toBe(postgresNamespace);
    expect(POSTGRES_DERIVERS.deriveTitle).toBe(postgresTitle);
    expect(POSTGRES_DERIVERS.deriveTags).toBe(postgresTags);
    expect(POSTGRES_DERIVERS.buildSources).toBe(postgresSources);
  });

  describe('postgresNamespace', () => {
    it('uses schema/table when schema is present', () => {
      expect(postgresNamespace({ table: 'users', schema: 'public' })).toBe('public/users');
    });

    it('uses database/table when database is present but no schema', () => {
      expect(postgresNamespace({ table: 'orders', database: 'mydb' })).toBe('mydb/orders');
    });

    it('prefers schema over database', () => {
      expect(postgresNamespace({ table: 'users', schema: 'auth', database: 'mydb' })).toBe('auth/users');
    });

    it('returns just table when no schema or database', () => {
      expect(postgresNamespace({ table: 'events' })).toBe('events');
    });

    it('returns "unknown" when table is missing', () => {
      expect(postgresNamespace({})).toBe('unknown');
    });
  });

  describe('postgresTitle', () => {
    it('uses metadata.title when present', () => {
      expect(postgresTitle({ title: 'User Record', table: 'users' })).toBe('User Record');
    });

    it('uses table/row_id when no title', () => {
      expect(postgresTitle({ table: 'users', row_id: 42 })).toBe('users/42');
    });

    it('uses table/row_id with string row_id', () => {
      expect(postgresTitle({ table: 'users', row_id: 'abc-123' })).toBe('users/abc-123');
    });

    it('uses table/unknown when no row_id', () => {
      expect(postgresTitle({ table: 'users' })).toBe('users/unknown');
    });

    it('handles missing table and row_id', () => {
      expect(postgresTitle({})).toBe('unknown/unknown');
    });

    it('does not use empty string title', () => {
      expect(postgresTitle({ title: '', table: 'users', row_id: 1 })).toBe('users/1');
    });
  });

  describe('postgresTags', () => {
    it('always includes postgres tag', () => {
      expect(postgresTags({})).toContain('postgres');
    });

    it('includes table and schema', () => {
      const tags = postgresTags({ table: 'Users', schema: 'Public' });
      expect(tags).toContain('postgres');
      expect(tags).toContain('users');
      expect(tags).toContain('public');
    });

    it('deduplicates and lowercases', () => {
      const tags = postgresTags({ table: 'POSTGRES', schema: 'test' });
      const postgresCount = tags.filter(t => t === 'postgres').length;
      expect(postgresCount).toBe(1);
    });

    it('appends extra tags', () => {
      const tags = postgresTags({ table: 'users' }, ['imported']);
      expect(tags).toContain('imported');
    });
  });

  describe('postgresSources', () => {
    it('builds database source with all fields', () => {
      const sources = postgresSources({
        table: 'users',
        connection_string: 'postgres://localhost/mydb',
        query: 'SELECT * FROM users',
      });
      expect(sources).toHaveLength(1);
      expect(sources[0].type).toBe('database');
      expect(sources[0].table).toBe('users');
      expect(sources[0].connection_string).toBe('postgres://localhost/mydb');
      expect(sources[0].query).toBe('SELECT * FROM users');
    });

    it('handles missing optional fields', () => {
      const sources = postgresSources({ table: 'events' });
      expect(sources).toHaveLength(1);
      expect(sources[0].type).toBe('database');
      expect(sources[0].table).toBe('events');
      expect(sources[0].connection_string).toBeUndefined();
      expect(sources[0].query).toBeUndefined();
    });
  });
});

// ─── WEB_DERIVERS ───────────────────────────────────────────

describe('WEB_DERIVERS', () => {
  it('has the correct shape', () => {
    expect(WEB_DERIVERS.deriveNamespace).toBe(webNamespace);
    expect(WEB_DERIVERS.deriveTitle).toBe(webTitle);
    expect(WEB_DERIVERS.deriveTags).toBe(webTags);
    expect(WEB_DERIVERS.buildSources).toBe(webSources);
  });

  describe('webNamespace', () => {
    it('parses hostname from URL and replaces dots with dashes', () => {
      expect(webNamespace({ url: 'https://docs.example.com/api/v2' })).toBe('web/docs-example-com');
    });

    it('handles simple domain', () => {
      expect(webNamespace({ url: 'https://localhost:3000/page' })).toBe('web/localhost');
    });

    it('returns web/unknown when URL is missing', () => {
      expect(webNamespace({})).toBe('web/unknown');
    });

    it('returns web/unknown for invalid URL', () => {
      expect(webNamespace({ url: 'not-a-url' })).toBe('web/unknown');
    });
  });

  describe('webTitle', () => {
    it('uses metadata.title when present', () => {
      expect(webTitle({ title: 'Getting Started', url: 'https://example.com/docs' })).toBe('Getting Started');
    });

    it('uses last path segment from URL when no title', () => {
      expect(webTitle({ url: 'https://example.com/docs/quickstart' })).toBe('quickstart');
    });

    it('returns page when URL has no path segments', () => {
      expect(webTitle({ url: 'https://example.com/' })).toBe('page');
    });

    it('returns page when no URL or title', () => {
      expect(webTitle({})).toBe('page');
    });

    it('does not use empty string title', () => {
      expect(webTitle({ title: '', url: 'https://example.com/about' })).toBe('about');
    });
  });

  describe('webTags', () => {
    it('always includes web tag', () => {
      expect(webTags({})).toContain('web');
    });

    it('includes domain when present', () => {
      const tags = webTags({ domain: 'example.com' });
      expect(tags).toContain('example.com');
    });

    it('extracts short content type', () => {
      const tags = webTags({ content_type: 'text/html; charset=utf-8' });
      expect(tags).toContain('html');
    });

    it('handles application/json content type', () => {
      const tags = webTags({ content_type: 'application/json' });
      expect(tags).toContain('json');
    });

    it('appends extra tags', () => {
      const tags = webTags({}, ['scraped', 'v2']);
      expect(tags).toContain('scraped');
      expect(tags).toContain('v2');
    });
  });

  describe('webSources', () => {
    it('builds web source with url and endpoint', () => {
      const sources = webSources({ url: 'https://example.com/page' });
      expect(sources).toHaveLength(1);
      expect(sources[0].type).toBe('web');
      expect(sources[0].url).toBe('https://example.com/page');
      expect(sources[0].endpoint).toBe('https://example.com/page');
      expect(sources[0].last_fetched).toBeDefined();
    });

    it('has ISO date in last_fetched', () => {
      const sources = webSources({ url: 'https://example.com' });
      // Verify it's a valid ISO string
      expect(() => new Date(sources[0].last_fetched as string)).not.toThrow();
    });

    it('handles missing URL', () => {
      const sources = webSources({});
      expect(sources).toHaveLength(1);
      expect(sources[0].type).toBe('web');
      expect(sources[0].url).toBeUndefined();
    });
  });
});

// ─── GIT_DERIVERS ───────────────────────────────────────────

describe('GIT_DERIVERS', () => {
  it('has the correct shape', () => {
    expect(GIT_DERIVERS.deriveNamespace).toBe(gitNamespace);
    expect(GIT_DERIVERS.deriveTitle).toBe(gitTitle);
    expect(GIT_DERIVERS.deriveTags).toBe(gitTags);
    expect(GIT_DERIVERS.buildSources).toBe(gitSources);
  });

  describe('gitNamespace', () => {
    it('extracts repo name from path', () => {
      expect(gitNamespace({ repo: '/home/user/projects/my-app' })).toBe('git/my-app');
    });

    it('extracts repo name from URL-like path', () => {
      expect(gitNamespace({ repo: 'github.com/user/cool-lib' })).toBe('git/cool-lib');
    });

    it('handles simple repo name', () => {
      expect(gitNamespace({ repo: 'my-repo' })).toBe('git/my-repo');
    });

    it('returns git/unknown when repo is missing', () => {
      expect(gitNamespace({})).toBe('git/unknown');
    });

    it('handles Windows-style paths', () => {
      expect(gitNamespace({ repo: 'C:\\Users\\dev\\project' })).toBe('git/project');
    });
  });

  describe('gitTitle', () => {
    it('uses file_path without extension', () => {
      expect(gitTitle({ file_path: 'src/main.ts' })).toBe('src/main');
    });

    it('uses file_path as-is when no extension', () => {
      expect(gitTitle({ file_path: 'Makefile' })).toBe('Makefile');
    });

    it('uses short commit SHA when no file_path', () => {
      expect(gitTitle({ commit_sha: 'abc1234567890' })).toBe('abc1234');
    });

    it('falls back to repo name', () => {
      expect(gitTitle({ repo: 'my-project' })).toBe('my-project');
    });

    it('returns unknown when nothing available', () => {
      expect(gitTitle({})).toBe('unknown');
    });
  });

  describe('gitTags', () => {
    it('always includes git tag', () => {
      expect(gitTags({})).toContain('git');
    });

    it('includes ref (branch name)', () => {
      const tags = gitTags({ ref: 'main', repo: 'my-app' });
      expect(tags).toContain('main');
      expect(tags).toContain('my-app');
    });

    it('extracts repo name from path', () => {
      const tags = gitTags({ repo: '/home/user/projects/cool-lib' });
      expect(tags).toContain('cool-lib');
    });

    it('deduplicates and lowercases', () => {
      const tags = gitTags({ ref: 'GIT', repo: 'GIT' });
      const gitCount = tags.filter(t => t === 'git').length;
      expect(gitCount).toBe(1);
    });

    it('appends extra tags', () => {
      const tags = gitTags({}, ['synced']);
      expect(tags).toContain('synced');
    });
  });

  describe('gitSources', () => {
    it('builds vcs source with all fields', () => {
      const sources = gitSources({
        repo: 'my-repo',
        ref: 'main',
        file_path: 'src/index.ts',
      });
      expect(sources).toHaveLength(1);
      expect(sources[0].type).toBe('vcs');
      expect(sources[0].repo).toBe('my-repo');
      expect(sources[0].ref).toBe('main');
      expect(sources[0].file_path).toBe('src/index.ts');
    });

    it('handles missing optional fields', () => {
      const sources = gitSources({});
      expect(sources).toHaveLength(1);
      expect(sources[0].type).toBe('vcs');
      expect(sources[0].repo).toBeUndefined();
      expect(sources[0].ref).toBeUndefined();
      expect(sources[0].file_path).toBeUndefined();
    });
  });
});
