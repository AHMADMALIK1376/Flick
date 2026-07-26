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
    speak: vi.fn(),
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

  it('greets and speaks when addressed by name with no command', async () => {
    service.setEnabled(true);

    const result = await service.process('Flick');

    expect(result.handled).toBe(true);
    expect(notify.speak).toHaveBeenCalledOnce();
    expect(notify.speak.mock.calls[0][0]).toMatch(/boss/i);
  });

  it('does not greet when a real command follows the name', async () => {
    service.setEnabled(true);

    // "flick open notepad" is a command, not a bare greeting. It won't reach
    // the tool loop here (no LLM), but it must not be treated as a greeting.
    const result = await service.process('flick open notepad');

    expect(notify.speak).not.toHaveBeenCalledWith(
      expect.stringMatching(/what can i do for you/i),
    );
    // handled either way; the point is it is not the greeting branch.
    expect(result).toBeDefined();
  });

  it('registers the desktop tools on construction', () => {
    expect(service.getToolNames()).toContain('open_application');
    expect(service.getToolNames()).toContain('open_path');
  });

  it('registers the browser agent as a tool', () => {
    expect(service.getToolNames()).toContain('browser_task');
  });

  it('exposes desktop, browser, and file tools', () => {
    const names = service.getToolNames();
    // 7 desktop + browser_task + close_browser + create_folder + create_file
    expect(names).toHaveLength(11);
    expect(names).toContain('create_folder');
    expect(names).toContain('create_file');
    expect(names).toContain('power_control');
    expect(names).toContain('close_browser');
  });
});
