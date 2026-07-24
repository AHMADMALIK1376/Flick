import { describe, it, expect, vi } from 'vitest';
import { ToolLoop } from './tool-loop';
import { ToolRegistry } from './tools/tool-registry';
import { PermissionGate } from './tools/permission-gate';
import type { ToolDescriptor } from './tools/tool-types';

const openApp: ToolDescriptor = {
  name: 'open_application',
  description: 'Launch an app.',
  sideEffecting: true,
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string' } },
    required: ['name'],
  },
};

function registryWith(
  handler = vi.fn(async () => ({ ok: true as const, content: 'ok' }))
) {
  const registry = new ToolRegistry();
  registry.register(openApp, handler);
  return { registry, handler };
}

const allowAll = new PermissionGate(async () => true);

describe('ToolLoop', () => {
  it('returns the final message when the model calls no tools', async () => {
    const { registry } = registryWith();
    const turn = vi.fn().mockResolvedValue({
      toolCalls: [],
      finalMessage: 'Lahore is 34 degrees.',
    });

    const outcome = await new ToolLoop(registry, allowAll, turn).run('weather', 'en');

    expect(outcome.finalMessage).toBe('Lahore is 34 degrees.');
    expect(outcome.steps).toHaveLength(0);
  });

  it('executes a tool the model asks for', async () => {
    const { registry, handler } = registryWith();
    const turn = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
      })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'Opened Spotify.' });

    const outcome = await new ToolLoop(registry, allowAll, turn).run(
      'open spotify',
      'en'
    );

    expect(handler).toHaveBeenCalledWith({ name: 'spotify' });
    expect(outcome.finalMessage).toBe('Opened Spotify.');
    expect(outcome.steps).toHaveLength(1);
  });

  it('chains multiple tool calls across turns', async () => {
    const { registry } = registryWith();
    const turn = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
      })
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'playlist' } }],
      })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'Playing.' });

    const outcome = await new ToolLoop(registry, allowAll, turn).run(
      'play music',
      'en'
    );

    expect(outcome.steps).toHaveLength(2);
    expect(outcome.finalMessage).toBe('Playing.');
  });

  it('feeds the tool result back to the model', async () => {
    const { registry } = registryWith(
      vi.fn(async () => ({ ok: true as const, content: 'spotify launched' }))
    );
    const turn = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
      })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'done' });

    await new ToolLoop(registry, allowAll, turn).run('open spotify', 'en');

    const secondCallHistory = turn.mock.calls[1][0];
    expect(JSON.stringify(secondCallHistory)).toContain('spotify launched');
  });

  it('stops at the step limit rather than looping forever', async () => {
    const { registry } = registryWith();
    const turn = vi.fn().mockResolvedValue({
      toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
    });

    const outcome = await new ToolLoop(registry, allowAll, turn, 3).run('go', 'en');

    expect(outcome.steps).toHaveLength(3);
    expect(outcome.stoppedReason).toBe('step_limit');
  });

  it('does not run a tool the user declined', async () => {
    const { registry, handler } = registryWith();
    const denyAll = new PermissionGate(async () => false);
    const turn = vi
      .fn()
      .mockResolvedValueOnce({
        toolCalls: [{ name: 'open_application', args: { name: 'spotify' } }],
      })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'Cancelled.' });

    await new ToolLoop(registry, denyAll, turn).run('open spotify', 'en');

    expect(handler).not.toHaveBeenCalled();
  });

  it('reports an unknown tool back to the model instead of throwing', async () => {
    const { registry } = registryWith();
    const turn = vi
      .fn()
      .mockResolvedValueOnce({ toolCalls: [{ name: 'nope', args: {} }] })
      .mockResolvedValueOnce({ toolCalls: [], finalMessage: 'Sorry.' });

    const outcome = await new ToolLoop(registry, allowAll, turn).run('x', 'en');

    expect(outcome.steps[0].result.ok).toBe(false);
    expect(outcome.finalMessage).toBe('Sorry.');
  });

  it('carries the language hint into the opening message', async () => {
    const { registry } = registryWith();
    const turn = vi.fn().mockResolvedValue({ toolCalls: [], finalMessage: 'ok' });

    await new ToolLoop(registry, allowAll, turn).run('chrome kholo', 'roman-ur');

    const history = turn.mock.calls[0][0];
    expect(JSON.stringify(history)).toContain('roman-ur');
  });
});
