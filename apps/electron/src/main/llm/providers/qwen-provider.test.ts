import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QwenProvider } from './qwen-provider';

describe('QwenProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reports its id', () => {
    expect(new QwenProvider().id).toBe('qwen');
  });

  it('returns an error when the key is missing', async () => {
    const result = await new QwenProvider().textComplete({
      apiKey: '',
      modelId: 'qwen-plus',
      systemPrompt: 'sys',
      userMessage: 'hi',
      jsonMode: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('missing_key');
    }
  });

  it('returns text on a successful completion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: 'hello' } }] }),
      })
    );

    const result = await new QwenProvider().textComplete({
      apiKey: 'test-key',
      modelId: 'qwen-plus',
      systemPrompt: 'sys',
      userMessage: 'hi',
      jsonMode: false,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe('hello');
    }
  });

  it('maps HTTP 401 to invalid_key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      })
    );

    const result = await new QwenProvider().textComplete({
      apiKey: 'bad-key',
      modelId: 'qwen-plus',
      systemPrompt: 'sys',
      userMessage: 'hi',
      jsonMode: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid_key');
    }
  });

  it('maps an empty choices array to empty_response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ choices: [] }),
      })
    );

    const result = await new QwenProvider().textComplete({
      apiKey: 'test-key',
      modelId: 'qwen-plus',
      systemPrompt: 'sys',
      userMessage: 'hi',
      jsonMode: false,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('empty_response');
    }
  });
});
