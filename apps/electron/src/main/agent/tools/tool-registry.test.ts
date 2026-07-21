import { describe, it, expect } from 'vitest';
import { ToolRegistry } from './tool-registry';
import type { ToolDescriptor } from './tool-types';

const openApp: ToolDescriptor = {
  name: 'open_application',
  description: 'Launch an application by name.',
  sideEffecting: false,
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Application name' } },
    required: ['name'],
  },
};

describe('ToolRegistry', () => {
  it('registers and retrieves a tool', () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => ({ ok: true, content: 'launched' }));

    expect(registry.get('open_application')).toBeDefined();
  });

  it('returns undefined for an unknown tool', () => {
    expect(new ToolRegistry().get('nope')).toBeUndefined();
  });

  it('rejects duplicate registration', () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => ({ ok: true, content: '' }));

    expect(() =>
      registry.register(openApp, async () => ({ ok: true, content: '' }))
    ).toThrow(/already registered/i);
  });

  it('lists every registered tool', () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => ({ ok: true, content: '' }));

    expect(registry.list().map((t) => t.name)).toEqual(['open_application']);
  });

  it('describes tools in the shape a model expects', () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => ({ ok: true, content: '' }));

    expect(registry.describeForModel()).toEqual([
      {
        name: 'open_application',
        description: 'Launch an application by name.',
        input_schema: openApp.inputSchema,
      },
    ]);
  });

  it('invokes the handler registered for a tool', async () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async (args) => ({
      ok: true,
      content: `launched ${args.name}`,
    }));

    const result = await registry.invoke('open_application', { name: 'spotify' });

    expect(result).toEqual({ ok: true, content: 'launched spotify' });
  });

  it('returns an error result when invoking an unknown tool', async () => {
    const result = await new ToolRegistry().invoke('nope', {});

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/unknown tool/i);
    }
  });

  it('converts a handler throw into an error result', async () => {
    const registry = new ToolRegistry();
    registry.register(openApp, async () => {
      throw new Error('spotify is not installed');
    });

    const result = await registry.invoke('open_application', { name: 'spotify' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('spotify is not installed');
    }
  });
});
