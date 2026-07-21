import { describe, it, expect, vi } from 'vitest';
import { PermissionGate } from './permission-gate';
import type { ToolDescriptor } from './tool-types';

const readOnly: ToolDescriptor = {
  name: 'get_weather',
  description: 'Look up the weather.',
  sideEffecting: false,
  inputSchema: { type: 'object', properties: {} },
};

const sideEffecting: ToolDescriptor = {
  name: 'send_message',
  description: 'Send a WhatsApp message.',
  sideEffecting: true,
  inputSchema: {
    type: 'object',
    properties: { to: { type: 'string' }, body: { type: 'string' } },
  },
};

describe('PermissionGate', () => {
  it('allows a read-only tool without prompting', async () => {
    const confirm = vi.fn();
    const gate = new PermissionGate(confirm);

    const decision = await gate.check(readOnly, {});

    expect(decision.allowed).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('prompts before a side-effecting tool', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate(confirm);

    const decision = await gate.check(sideEffecting, {
      to: 'Ami Jan',
      body: 'late',
    });

    expect(decision.allowed).toBe(true);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('passes the tool name and arguments to the prompt', async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const gate = new PermissionGate(confirm);

    await gate.check(sideEffecting, { to: 'Ami Jan', body: 'late' });

    expect(confirm).toHaveBeenCalledWith({
      toolName: 'send_message',
      description: 'Send a WhatsApp message.',
      args: { to: 'Ami Jan', body: 'late' },
    });
  });

  it('blocks when the user declines', async () => {
    const gate = new PermissionGate(vi.fn().mockResolvedValue(false));

    const decision = await gate.check(sideEffecting, {});

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/declined/i);
  });

  it('blocks when the prompt throws, rather than allowing by default', async () => {
    const gate = new PermissionGate(
      vi.fn().mockRejectedValue(new Error('window closed'))
    );

    const decision = await gate.check(sideEffecting, {});

    expect(decision.allowed).toBe(false);
  });
});
