import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfirmBridge } from './confirm-bridge';

const request = {
  toolName: 'type_text',
  description: 'Type text into the focused window.',
  args: { text: 'hello' },
};

describe('ConfirmBridge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends the prompt to the renderer with an id', async () => {
    const send = vi.fn().mockReturnValue(true);
    const bridge = new ConfirmBridge(send);

    void bridge.confirm(request);

    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0][0]).toMatchObject({ toolName: 'type_text' });
    expect(send.mock.calls[0][0].id).toBeTypeOf('string');
  });

  it('resolves true when the user approves', async () => {
    const send = vi.fn().mockReturnValue(true);
    const bridge = new ConfirmBridge(send);

    const promise = bridge.confirm(request);
    bridge.resolve(send.mock.calls[0][0].id, true);

    await expect(promise).resolves.toBe(true);
  });

  it('resolves false when the user declines', async () => {
    const send = vi.fn().mockReturnValue(true);
    const bridge = new ConfirmBridge(send);

    const promise = bridge.confirm(request);
    bridge.resolve(send.mock.calls[0][0].id, false);

    await expect(promise).resolves.toBe(false);
  });

  it('fails closed when there is no window to prompt', async () => {
    const bridge = new ConfirmBridge(() => false);

    await expect(bridge.confirm(request)).resolves.toBe(false);
  });

  /**
   * Without a timeout, closing the dialog window would leave the agent loop
   * awaiting a promise that never settles — hanging Flick until restart.
   */
  it('fails closed after the timeout elapses', async () => {
    const bridge = new ConfirmBridge(() => true);

    const promise = bridge.confirm(request);
    await vi.advanceTimersByTimeAsync(61_000);

    await expect(promise).resolves.toBe(false);
  });

  it('ignores an answer for an unknown id', () => {
    const bridge = new ConfirmBridge(() => true);

    expect(() => bridge.resolve('never-issued', true)).not.toThrow();
  });

  it('ignores a second answer for the same prompt', async () => {
    const send = vi.fn().mockReturnValue(true);
    const bridge = new ConfirmBridge(send);

    const promise = bridge.confirm(request);
    const id = send.mock.calls[0][0].id;
    bridge.resolve(id, true);
    bridge.resolve(id, false);

    await expect(promise).resolves.toBe(true);
    expect(bridge.pendingCount()).toBe(0);
  });

  it('fails every outstanding prompt closed on cancelAll', async () => {
    const bridge = new ConfirmBridge(() => true);

    const a = bridge.confirm(request);
    const b = bridge.confirm(request);
    bridge.cancelAll();

    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);
    expect(bridge.pendingCount()).toBe(0);
  });
});
