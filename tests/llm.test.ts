import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { llmSummarize, llmClassify } from '../src/llm.js';

// ─── Helpers ─────────────────────────────────────────────────

/** Save and restore env vars around tests */
function withEnv(vars: Record<string, string | undefined>, fn: () => void | Promise<void>) {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const key of Object.keys(vars)) {
      saved[key] = process.env[key];
      if (vars[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = vars[key];
      }
    }
    try {
      await fn();
    } finally {
      for (const key of Object.keys(saved)) {
        if (saved[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = saved[key];
        }
      }
    }
  };
}

/** Create a mock fetch that returns a successful OpenAI response */
function mockFetchSuccess(content: string) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
    }),
  });
}

/** Create a mock fetch that throws an error */
function mockFetchError(message: string) {
  return vi.fn().mockRejectedValue(new Error(message));
}

// ─── Tests ───────────────────────────────────────────────────

describe('llmSummarize', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Ensure no API key leaks from env
    delete process.env.OPENAI_API_KEY;
    delete process.env.BLINK_LLM_PROVIDER;
    delete process.env.BLINK_LLM_MODEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when no API key is available', () => {
    expect(() => llmSummarize()).toThrow(
      'OPENAI_API_KEY required: set env var or pass apiKey in config',
    );
  });

  it('returns a function when apiKey is provided', () => {
    const fn = llmSummarize({ apiKey: 'test-key' });
    expect(typeof fn).toBe('function');
  });

  it('returned function has correct SummarizeCallback signature', () => {
    const fn = llmSummarize({ apiKey: 'test-key' });
    // SummarizeCallback takes (text, metadata) => string | Promise<string>
    expect(fn.length).toBe(2);
  });

  it(
    'reads API key from OPENAI_API_KEY env var',
    withEnv({ OPENAI_API_KEY: 'env-key' }, () => {
      const fn = llmSummarize();
      expect(typeof fn).toBe('function');
    }),
  );

  it(
    'reads provider from BLINK_LLM_PROVIDER env var',
    withEnv({ OPENAI_API_KEY: 'env-key', BLINK_LLM_PROVIDER: 'openai' }, () => {
      // Should not throw — 'openai' is valid
      const fn = llmSummarize();
      expect(typeof fn).toBe('function');
    }),
  );

  it('calls OpenAI API and returns the summary', async () => {
    const mockFetch = mockFetchSuccess('This is a concise summary.');
    vi.stubGlobal('fetch', mockFetch);

    const summarize = llmSummarize({ apiKey: 'test-key' });
    const result = await summarize('Some long document text...', {});

    expect(result).toBe('This is a concise summary.');
    expect(mockFetch).toHaveBeenCalledOnce();

    // Verify the request structure
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe('Bearer test-key');

    const body = JSON.parse(options.body);
    expect(body.model).toBe('gpt-4o-mini');
    expect(body.temperature).toBe(0.3);
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[1].role).toBe('user');
  });

  it('truncates input text to maxInputChars', async () => {
    const mockFetch = mockFetchSuccess('Summary of truncated text.');
    vi.stubGlobal('fetch', mockFetch);

    const longText = 'a'.repeat(20000);
    const summarize = llmSummarize({ apiKey: 'test-key', maxInputChars: 100 });
    await summarize(longText, {});

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    const userMessage = body.messages[1].content;
    expect(userMessage.length).toBe(100);
  });

  it('uses custom model from config', async () => {
    const mockFetch = mockFetchSuccess('Summary.');
    vi.stubGlobal('fetch', mockFetch);

    const summarize = llmSummarize({ apiKey: 'test-key', model: 'gpt-4o' });
    await summarize('text', {});

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.model).toBe('gpt-4o');
  });

  it(
    'reads model from BLINK_LLM_MODEL env var',
    withEnv({ OPENAI_API_KEY: 'env-key', BLINK_LLM_MODEL: 'gpt-3.5-turbo' }, async () => {
      const mockFetch = mockFetchSuccess('Summary.');
      vi.stubGlobal('fetch', mockFetch);

      const summarize = llmSummarize();
      await summarize('text', {});

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.model).toBe('gpt-3.5-turbo');
    }),
  );

  it('falls back to extractive summarizer on fetch error', async () => {
    const mockFetch = mockFetchError('Network failure');
    vi.stubGlobal('fetch', mockFetch);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const summarize = llmSummarize({ apiKey: 'test-key' });
    const result = await summarize('Hello world this is a test document.', {});

    // Should return extractive summary (the text itself, since it's short)
    expect(result).toBe('Hello world this is a test document.');
    // Should log warning to stderr
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('LLM summarize failed'),
    );

    stderrSpy.mockRestore();
  });

  it('uses custom system prompt', async () => {
    const mockFetch = mockFetchSuccess('Custom summary.');
    vi.stubGlobal('fetch', mockFetch);

    const customPrompt = 'Summarize in exactly one sentence.';
    const summarize = llmSummarize({ apiKey: 'test-key', systemPrompt: customPrompt });
    await summarize('text', {});

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toBe(customPrompt);
  });
});

describe('llmClassify', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
    delete process.env.BLINK_LLM_PROVIDER;
    delete process.env.BLINK_LLM_MODEL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when no API key is available', () => {
    expect(() => llmClassify()).toThrow(
      'OPENAI_API_KEY required: set env var or pass apiKey in config',
    );
  });

  it('returns a function when apiKey is provided', () => {
    const fn = llmClassify({ apiKey: 'test-key' });
    expect(typeof fn).toBe('function');
  });

  it('returns a valid RecordType from API response', async () => {
    const mockFetch = mockFetchSuccess('SUMMARY');
    vi.stubGlobal('fetch', mockFetch);

    const classify = llmClassify({ apiKey: 'test-key' });
    const result = await classify('Some structured data...', {});

    expect(result).toBe('SUMMARY');
  });

  it('normalizes lowercase API response to uppercase RecordType', async () => {
    const mockFetch = mockFetchSuccess('meta');
    vi.stubGlobal('fetch', mockFetch);

    const classify = llmClassify({ apiKey: 'test-key' });
    const result = await classify('{ "key": "value" }', {});

    expect(result).toBe('META');
  });

  it('defaults to SOURCE for unrecognized classification', async () => {
    const mockFetch = mockFetchSuccess('DOCUMENT');
    vi.stubGlobal('fetch', mockFetch);

    const classify = llmClassify({ apiKey: 'test-key' });
    const result = await classify('Some text', {});

    expect(result).toBe('SOURCE');
  });

  it('defaults to SOURCE on fetch error', async () => {
    const mockFetch = mockFetchError('API down');
    vi.stubGlobal('fetch', mockFetch);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const classify = llmClassify({ apiKey: 'test-key' });
    const result = await classify('Some text', {});

    expect(result).toBe('SOURCE');
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('LLM classify failed'),
    );

    stderrSpy.mockRestore();
  });
});
