import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from './tool-registry';
import { registerDesktopTools } from './desktop-tools';
import type { ExecutionResult } from '../../../shared/types';

/**
 * Typed as the real ExecutionResult rather than a loose object literal.
 * An untyped mock previously invented a `message` field the real interface
 * does not have, so these tests passed against an interface that cannot exist.
 */
function ok(action = 'open_application'): ExecutionResult {
  return { success: true, action: action as never, target: 't', durationMs: 1 };
}

function fail(error: string): ExecutionResult {
  return {
    success: false,
    action: 'open_application' as never,
    target: 't',
    error,
    durationMs: 1,
  };
}

function setup(executeImpl?: () => Promise<ExecutionResult>) {
  const execute = vi.fn(executeImpl ?? (async () => ok()));
  const registry = new ToolRegistry();
  registerDesktopTools(registry, { execute } as never);
  return { registry, execute };
}

describe('registerDesktopTools', () => {
  it('registers the desktop tools', () => {
    const { registry } = setup();

    expect(registry.list().map((t) => t.name).sort()).toEqual([
      'open_application',
      'open_path',
      'open_url',
      'system_control',
      'type_text',
      'web_search',
    ]);
  });

  /**
   * Risk tiers, not a blanket flag. Prompting for "open notepad" trains the
   * user to click through every dialog, which makes the gate worthless when it
   * matters.
   */
  it('does not gate reversible, visible actions', () => {
    const { registry } = setup();

    for (const name of ['open_application', 'open_url', 'web_search', 'open_path']) {
      expect(registry.get(name)?.sideEffecting, `${name} should not prompt`).toBe(
        false
      );
    }
  });

  // Typing and system control run without a prompt: both are visible and
  // reversible (Ctrl+Z; unmute; unlock). browser_task is the gated one — it
  // acts as the signed-in user on real sites and is tested in browser-tools.
  it('does not gate typing', () => {
    const { registry } = setup();

    expect(registry.get('type_text')?.sideEffecting).toBe(false);
  });

  it('does not gate system control', () => {
    const { registry } = setup();

    expect(registry.get('system_control')?.sideEffecting).toBe(false);
  });

  it('maps open_application onto the executor intent', async () => {
    const { registry, execute } = setup();

    await registry.invoke('open_application', { name: 'spotify' });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'open_application', target: 'spotify' })
    );
  });

  it('maps open_path onto the executor intent', async () => {
    const { registry, execute } = setup();

    await registry.invoke('open_path', { path: 'C:\\Users' });

    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'open_path', target: 'C:\\Users' })
    );
  });

  it('returns a success result the model can read', async () => {
    const { registry } = setup();

    const result = await registry.invoke('open_application', { name: 'spotify' });

    expect(result.ok).toBe(true);
  });

  it('surfaces executor failure as an error result', async () => {
    const { registry } = setup(async () => fail('application not found'));

    const result = await registry.invoke('open_application', { name: 'nope' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('application not found');
    }
  });

  it('rejects a missing required argument without calling the executor', async () => {
    const { registry, execute } = setup();

    const result = await registry.invoke('open_application', {});

    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects a blank argument without calling the executor', async () => {
    const { registry, execute } = setup();

    const result = await registry.invoke('open_application', { name: '   ' });

    expect(result.ok).toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });
});
