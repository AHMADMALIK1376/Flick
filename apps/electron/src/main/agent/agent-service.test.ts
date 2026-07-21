import { describe, it, expect, vi, beforeEach } from 'vitest';

// AgentService constructs AgentStore -> electron-store, and ActionExecutor
// reaches for Electron's shell. Neither exists outside a real Electron process,
// so both are stubbed here.
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/flick-test' },
  shell: { openExternal: vi.fn(), openPath: vi.fn() },
}));

vi.mock('electron-store', () => ({
  default: class {
    private data = new Map<string, unknown>();
    get(key: string) {
      return this.data.get(key);
    }
    set(key: string, value: unknown) {
      this.data.set(key, value);
    }
  },
}));

const { AgentService } = await import('./agent-service');

function notifier() {
  return {
    notifySuccess: vi.fn(),
    notifyError: vi.fn(),
    notifyUnrecognized: vi.fn(),
  };
}

describe('AgentService', () => {
  let service: InstanceType<typeof AgentService>;
  let notify: ReturnType<typeof notifier>;

  beforeEach(() => {
    notify = notifier();
    service = new AgentService(notify);
  });

  it('passes dictation through without handling it', async () => {
    service.setEnabled(true);

    const result = await service.process('the meeting went well today');

    expect(result.handled).toBe(false);
  });

  it('passes everything through while disabled', async () => {
    service.setEnabled(false);

    const result = await service.process('open chrome');

    expect(result.handled).toBe(false);
  });

  it('registers the desktop tools on construction', () => {
    expect(service.getToolNames()).toContain('open_application');
    expect(service.getToolNames()).toContain('open_path');
  });

  it('exposes exactly the six desktop tools', () => {
    expect(service.getToolNames()).toHaveLength(6);
  });
});
