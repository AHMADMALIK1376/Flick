import { describe, it, expect, vi } from 'vitest';
import {
  buildToolSystemPrompt,
  createLlmTurnFn,
  extractJsonObject,
} from './llm-turn-adapter';
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

describe('extractJsonObject', () => {
  it('returns a bare object unchanged', () => {
    expect(extractJsonObject('{"a":1}')).toBe('{"a":1}');
  });

  it('extracts an object wrapped in prose', () => {
    expect(
      extractJsonObject('Sure, here you go: {"tool_calls":[]} — done!'),
    ).toBe('{"tool_calls":[]}');
  });

  it('extracts an object from a markdown fence', () => {
    expect(
      extractJsonObject('```json\n{"tool_calls":[]}\n```'),
    ).toBe('{"tool_calls":[]}');
  });

  it('handles nested objects', () => {
    const s = '{"tool_calls":[{"name":"x","args":{"a":1}}]}';
    expect(extractJsonObject(`prefix ${s} suffix`)).toBe(s);
  });

  /**
   * The exact failure from the field: a type_text arg whose text contains
   * a brace or a quoted comma must not end the object early.
   */
  it('does not stop on a brace inside a string value', () => {
    const s = '{"text":"use {curly} and \\"quotes\\" here"}';
    expect(extractJsonObject(`noise ${s} noise`)).toBe(s);
  });

  it('returns null when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
  });

  it('returns null for an unbalanced object', () => {
    expect(extractJsonObject('{"a":1')).toBeNull();
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

  /**
   * The reported failure: "open notepad and write this. My name is..." made
   * the model prepend prose to its JSON, which the old whole-string parse
   * rejected — the user saw "I didn't understand that" on a command the model
   * had understood.
   */
  it('parses a multi-step reply the model wrapped in prose', async () => {
    const turn = createLlmTurnFn(
      llmReturning(
        'Sure! I\'ll open Notepad and type that.\n' +
          '{"tool_calls":[' +
          '{"name":"open_application","args":{"name":"notepad"}},' +
          '{"name":"type_text","args":{"text":"My name is Ahmad, I am 21."}}' +
          ']}',
      ),
      registry(),
    );

    const result = await turn([{ role: 'user', content: 'open notepad and write this' }]);

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls[0].name).toBe('open_application');
    expect(result.toolCalls[1]).toEqual({
      name: 'type_text',
      args: { text: 'My name is Ahmad, I am 21.' },
    });
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
