import { describe, it, expect, vi } from 'vitest';
import { ToolRegistry } from './tool-registry';
import { registerBrowserTools } from './browser-tools';
import type { BrowserTaskResult } from '../../../shared/types';

function done(over: Partial<BrowserTaskResult> = {}): BrowserTaskResult {
  return {
    taskId: 't1',
    status: 'completed',
    stepsCompleted: 3,
    ...over,
  };
}

function setup(impl?: () => Promise<BrowserTaskResult>) {
  const runBrowserTask = vi.fn(impl ?? (async () => done()));
  const registry = new ToolRegistry();
  registerBrowserTools(registry, { runBrowserTask } as never);
  return { registry, runBrowserTask };
}

describe('registerBrowserTools', () => {
  it('registers browser_task', () => {
    expect(setup().registry.get('browser_task')).toBeDefined();
  });

  /**
   * The browser agent runs on a persistent profile, so it acts as the
   * signed-in user. A misheard instruction could click Buy or Send.
   */
  it('gates browser_task behind confirmation', () => {
    expect(setup().registry.get('browser_task')?.sideEffecting).toBe(true);
  });

  it('steers the model away from it for simple page opens', () => {
    const description = setup().registry.get('browser_task')?.description ?? '';
    expect(description).toMatch(/prefer open_url|web_search/i);
  });

  it('passes the task through to the executor', async () => {
    const { registry, runBrowserTask } = setup();

    await registry.invoke('browser_task', { task: 'play the first result' });

    expect(runBrowserTask).toHaveBeenCalledWith('play the first result');
  });

  it('returns what the agent read off the page', async () => {
    const { registry } = setup(async () =>
      done({ result: 'The assignment is due Friday.' })
    );

    const result = await registry.invoke('browser_task', { task: 'read it' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('due Friday');
    }
  });

  it('includes structured data when present', async () => {
    const { registry } = setup(async () =>
      done({ structuredData: { title: 'Essay 2' } })
    );

    const result = await registry.invoke('browser_task', { task: 'read it' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('Essay 2');
    }
  });

  it('reports a failed task as an error', async () => {
    const { registry } = setup(async () =>
      done({ status: 'failed', error: 'login wall' })
    );

    const result = await registry.invoke('browser_task', { task: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('login wall');
    }
  });

  it('reports a cancelled task as an error even without a message', async () => {
    const { registry } = setup(async () => done({ status: 'cancelled' }));

    const result = await registry.invoke('browser_task', { task: 'x' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/cancelled/i);
    }
  });

  it('rejects a missing task argument without calling the executor', async () => {
    const { registry, runBrowserTask } = setup();

    const result = await registry.invoke('browser_task', {});

    expect(result.ok).toBe(false);
    expect(runBrowserTask).not.toHaveBeenCalled();
  });
});
