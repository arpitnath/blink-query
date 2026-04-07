import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFromGitHubIssues } from '../src/adapters.js';
import {
  githubNamespace,
  githubTitle,
  githubTags,
  githubSources,
} from '../src/ingest.js';

// ─── Mock global fetch ────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Test data helpers ────────────────────────────────────────

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    number: 42,
    title: 'Fix the bug',
    body: 'This is the issue body with details.',
    state: 'open',
    labels: [{ name: 'bug' }, { name: 'help wanted' }],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-02T00:00:00Z',
    html_url: 'https://github.com/owner/repo/issues/42',
    user: { login: 'alice' },
    ...overrides,
  };
}

function makeFetchResponse(issues: unknown[], ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Forbidden',
    json: async () => issues,
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

// ─── loadFromGitHubIssues ─────────────────────────────────────

describe('loadFromGitHubIssues', () => {
  it('fetches issues and maps to IngestDocuments correctly', async () => {
    const issue = makeIssue();
    mockFetch.mockResolvedValueOnce(makeFetchResponse([issue]));
    mockFetch.mockResolvedValueOnce(makeFetchResponse([])); // empty page stops loop

    const docs = await loadFromGitHubIssues({ repo: 'owner/repo' });

    expect(docs).toHaveLength(1);
    const doc = docs[0];
    expect(doc.id).toBe('42');
    expect(doc.text).toBe(issue.body);
    expect(doc.metadata.repo).toBe('owner/repo');
    expect(doc.metadata.issue_number).toBe(42);
    expect(doc.metadata.title).toBe('Fix the bug');
    expect(doc.metadata.state).toBe('open');
    expect(doc.metadata.labels).toEqual(['bug', 'help wanted']);
    expect(doc.metadata.html_url).toBe('https://github.com/owner/repo/issues/42');
    expect(doc.metadata.user).toBe('alice');
    expect(doc.metadata.is_pull_request).toBe(false);
  });

  it('skips pull requests (issues with pull_request field)', async () => {
    const pr = makeIssue({ pull_request: { url: 'https://api.github.com/repos/owner/repo/pulls/42' } });
    const realIssue = makeIssue({ number: 43, title: 'Real issue', body: 'Not a PR.' });
    mockFetch.mockResolvedValueOnce(makeFetchResponse([pr, realIssue]));
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    const docs = await loadFromGitHubIssues({ repo: 'owner/repo' });

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('43');
  });

  it('skips issues with empty body', async () => {
    const emptyBody = makeIssue({ number: 10, body: '' });
    const whitespaceBody = makeIssue({ number: 11, body: '   \n  ' });
    const goodIssue = makeIssue({ number: 12, body: 'Has content.' });
    mockFetch.mockResolvedValueOnce(makeFetchResponse([emptyBody, whitespaceBody, goodIssue]));
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    const docs = await loadFromGitHubIssues({ repo: 'owner/repo' });

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('12');
  });

  it('passes Authorization header when token is provided', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse([makeIssue()]));
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    await loadFromGitHubIssues({ repo: 'owner/repo', token: 'ghp_mytoken' });

    const [, fetchOptions] = mockFetch.mock.calls[0];
    expect(fetchOptions.headers['Authorization']).toBe('Bearer ghp_mytoken');
  });

  it('does not send Authorization header when no token is set', async () => {
    // Ensure GITHUB_TOKEN env is not set for this test
    const savedToken = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;

    mockFetch.mockResolvedValueOnce(makeFetchResponse([makeIssue()]));
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    await loadFromGitHubIssues({ repo: 'owner/repo' });

    const [, fetchOptions] = mockFetch.mock.calls[0];
    expect(fetchOptions.headers['Authorization']).toBeUndefined();

    // Restore
    if (savedToken !== undefined) process.env.GITHUB_TOKEN = savedToken;
  });

  it('respects maxPages limit', async () => {
    // Each page returns one issue; stop after maxPages=2
    mockFetch.mockResolvedValue(makeFetchResponse([makeIssue()]));

    const docs = await loadFromGitHubIssues({ repo: 'owner/repo', maxPages: 2, perPage: 1 });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(docs).toHaveLength(2);
  });

  it('stops pagination when page has fewer results than perPage', async () => {
    // perPage=10, but first page returns only 3 issues — should stop
    const issues = [makeIssue({ number: 1 }), makeIssue({ number: 2 }), makeIssue({ number: 3 })];
    mockFetch.mockResolvedValueOnce(makeFetchResponse(issues));

    const docs = await loadFromGitHubIssues({ repo: 'owner/repo', perPage: 10 });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(docs).toHaveLength(3);
  });

  it('passes labels filter in URL params', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse([makeIssue()]));
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    await loadFromGitHubIssues({ repo: 'owner/repo', labels: ['bug', 'enhancement'] });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('labels=bug%2Cenhancement');
  });

  it('includes state param in URL', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse([makeIssue()]));
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    await loadFromGitHubIssues({ repo: 'owner/repo', state: 'open' });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain('state=open');
  });

  it('throws on invalid repo format', async () => {
    await expect(loadFromGitHubIssues({ repo: 'invalid-no-slash' })).rejects.toThrow(
      'repo must be in "owner/repo" format',
    );
  });

  it('throws on GitHub API error response', async () => {
    mockFetch.mockResolvedValueOnce(makeFetchResponse([], false, 403));

    await expect(loadFromGitHubIssues({ repo: 'owner/repo' })).rejects.toThrow(
      'GitHub API error: 403',
    );
  });

  it('calls onPage callback after each page', async () => {
    const onPage = vi.fn();
    mockFetch.mockResolvedValueOnce(makeFetchResponse([makeIssue({ number: 1 }), makeIssue({ number: 2 })]));
    mockFetch.mockResolvedValueOnce(makeFetchResponse([]));

    await loadFromGitHubIssues({ repo: 'owner/repo', onPage });

    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenCalledWith(1, 2);
  });
});

// ─── GitHub derivers ──────────────────────────────────────────

describe('githubNamespace', () => {
  it('includes repo and first label in namespace', () => {
    const metadata = {
      repo: 'owner/repo',
      labels: ['bug', 'enhancement'],
    };
    expect(githubNamespace(metadata)).toBe('github/owner/repo/issues/bug');
  });

  it('falls back to unlabeled when no labels', () => {
    const metadata = { repo: 'owner/repo', labels: [] };
    expect(githubNamespace(metadata)).toBe('github/owner/repo/issues/unlabeled');
  });

  it('sanitizes label for path safety', () => {
    const metadata = { repo: 'owner/repo', labels: ['C++ Bug', 'foo/bar'] };
    const ns = githubNamespace(metadata);
    // Should not contain spaces or slashes in the label part
    expect(ns).toMatch(/^github\/owner\/repo\/issues\/[a-z0-9-]+$/);
  });

  it('falls back to unknown repo when missing', () => {
    const metadata = { labels: ['bug'] };
    expect(githubNamespace(metadata)).toBe('github/unknown/issues/bug');
  });
});

describe('githubTitle', () => {
  it('returns the issue title from metadata', () => {
    const metadata = { title: 'My Issue Title', issue_number: 10 };
    expect(githubTitle(metadata)).toBe('My Issue Title');
  });

  it('falls back to issue-{number} when title is missing', () => {
    const metadata = { issue_number: 99 };
    expect(githubTitle(metadata)).toBe('issue-99');
  });
});

describe('githubTags', () => {
  it('includes "github" tag always', () => {
    const tags = githubTags({ repo: 'owner/repo', labels: [], state: 'open' });
    expect(tags).toContain('github');
  });

  it('includes labels as tags', () => {
    const tags = githubTags({ repo: 'owner/repo', labels: ['bug', 'help wanted'], state: 'open' });
    expect(tags).toContain('bug');
    expect(tags).toContain('help wanted');
  });

  it('includes repo name (without owner) as tag', () => {
    const tags = githubTags({ repo: 'vercel/next.js', labels: [], state: 'open' });
    expect(tags).toContain('next.js');
  });

  it('includes state as tag', () => {
    const tags = githubTags({ repo: 'owner/repo', labels: [], state: 'closed' });
    expect(tags).toContain('closed');
  });

  it('includes extra tags', () => {
    const tags = githubTags({ repo: 'owner/repo', labels: [], state: 'open' }, ['custom-tag']);
    expect(tags).toContain('custom-tag');
  });

  it('lowercases all tags and deduplicates', () => {
    const tags = githubTags({ repo: 'owner/repo', labels: ['Bug', 'BUG'], state: 'open' });
    const bugCount = tags.filter(t => t === 'bug').length;
    expect(bugCount).toBe(1);
  });
});

describe('githubSources', () => {
  it('includes html_url as web source', () => {
    const metadata = { html_url: 'https://github.com/owner/repo/issues/42' };
    const sources = githubSources(metadata);
    expect(sources).toHaveLength(1);
    expect(sources[0].type).toBe('web');
    expect(sources[0].url).toBe('https://github.com/owner/repo/issues/42');
  });

  it('includes last_fetched timestamp', () => {
    const metadata = { html_url: 'https://github.com/owner/repo/issues/1' };
    const sources = githubSources(metadata);
    expect(sources[0].last_fetched).toBeDefined();
    expect(new Date(sources[0].last_fetched as string).getTime()).toBeGreaterThan(0);
  });

  it('handles missing html_url gracefully', () => {
    const sources = githubSources({});
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBeUndefined();
  });
});
