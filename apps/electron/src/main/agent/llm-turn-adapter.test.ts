import { describe, it, expect, vi } from 'vitest';
import { buildToolSystemPrompt, createLlmTurnFn } from './llm-turn-adapter';
import { ToolRegistry } from './tools/tool-registry';
import type { LLMService } from './llm/llm-service';

function registry() {
  const r = new ToolRegistry();
  r.register(
    {
      name: 'open_application',
      description: 'Launch an app.',
      sideEffecting: true,
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    },
    async () => ({ ok: true, content: 'ok' })
  );
  return r;
}

function llmReturning(text: string): LLMService {
  return {
    textComplete: vi.fn().mockResolvedValue({ ok: true, text }),
  } as unknown as LLMService;
}

describe('buildToolSystemPrompt', () => {
  it('lists every registered tool', () => {
    expect(buildToolSystemPrompt(registry())).toContain('open_application');
  });

  it('states the language boundary', () => {
    const prompt = buildToolSystemPrompt(registry());
    expect(prompt).toMatch(/english/i);
    expect(prompt).toMatch(/urdu/i);
  });
});

describe('createLlmTurnFn', () => {
  it('parses tool calls from the model response', async () => {
    const turn = createLlmTurnFn(
      llmReturning(
        '{"tool_calls":[{"name":"open_application","args":{"name":"spotify"}}]}'
      ),
      registry()
    );

    const result = await turn([{ role: 'user', content: 'open spotify' }]);

    expect(result.toolCalls).toEqual([
      { name: 'open_application', args: { name: 'spotify' } },
    ]);
  });

  it('parses a final message when there are no tool calls', async () => {
    const turn = createLlmTurnFn(
      llmReturning('{"tool_calls":[],"final_message":"Lahore is 34 degrees."}'),
      registry()
    );

    const result = await turn([{ role: 'user', content: 'weather' }]);

    expect(result.toolCalls).toEqual([]);
    expect(result.finalMessage).toBe('Lahore is 34 degrees.');
  });

  it('strips markdown fences before parsing', async () => {
    const turn = createLlmTurnFn(
      llmReturning('```json\n{"tool_calls":[],"final_message":"hi"}\n```'),
      registry()
    );

    const result = await turn([{ role: 'user', content: 'hi' }]);

    expect(result.finalMessage).toBe('hi');
  });

  it('degrades to a spoken error when the model returns malformed JSON', async () => {
    const turn = createLlmTurnFn(llmReturning('not json at all'), registry());

    const result = await turn([{ role: 'user', content: 'x' }]);

    expect(result.toolCalls).toEqual([]);
    expect(result.finalMessage).toMatch(/didn't understand|could not/i);
  });

  it('degrades to a spoken error when the provider fails', async () => {
    const llm = {
      textComplete: vi.fn().mockResolvedValue({
        ok: false,
        error: { kind: 'network', message: 'offline' },
      }),
    } as unknown as LLMService;

    const result = await createLlmTurnFn(llm, registry())([
      { role: 'user', content: 'x' },
    ]);

    expect(result.toolCalls).toEqual([]);
    expect(result.finalMessage).toContain('offline');
  });

  it('drops malformed tool call entries rather than passing them on', async () => {
    const turn = createLlmTurnFn(
      llmReturning('{"tool_calls":[{"noname":true},{"name":"open_application"}]}'),
      registry()
    );

    const result = await turn([{ role: 'user', content: 'x' }]);

    expect(result.toolCalls).toEqual([{ name: 'open_application', args: {} }]);
  });

  it('sends the conversation history to the model', async () => {
    const llm = llmReturning('{"tool_calls":[]}');
    const turn = createLlmTurnFn(llm, registry());

    await turn([
      { role: 'user', content: 'open spotify' },
      { role: 'tool', content: '{"tool":"open_application","result":{"ok":true}}' },
    ]);

    const userMessage = (llm.textComplete as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(userMessage).toContain('open spotify');
    expect(userMessage).toContain('open_application');
  });
});
