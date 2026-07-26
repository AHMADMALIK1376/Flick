import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// A temp directory stands in for the user's home, so tests never touch the real
// Desktop. Mocked before the module under test is imported.
const FAKE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'flick-home-'));

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof os>();
  return { ...actual, homedir: () => FAKE_HOME, default: { ...actual, homedir: () => FAKE_HOME } };
});

const openPath = vi.fn().mockResolvedValue('');
vi.mock('electron', () => ({ shell: { openPath: (p: string) => openPath(p) } }));

const { registerFileTools } = await import('./file-tools');
const { ToolRegistry } = await import('./tool-registry');

const DESKTOP = path.join(FAKE_HOME, 'Desktop');

function setup() {
  const registry = new ToolRegistry();
  registerFileTools(registry);
  return registry;
}

beforeEach(() => {
  openPath.mockClear();
});

afterEach(() => {
  fs.rmSync(DESKTOP, { recursive: true, force: true });
});

describe('create_folder', () => {
  it('is registered and does not require confirmation', () => {
    const r = setup();
    expect(r.get('create_folder')).toBeDefined();
    expect(r.get('create_folder')?.sideEffecting).toBe(false);
  });

  it('creates a folder on the desktop from a bare name', async () => {
    const res = await setup().invoke('create_folder', { location: 'Secret Project' });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(DESKTOP, 'Secret Project'))).toBe(true);
  });

  it('creates a nested folder, making parents', async () => {
    const res = await setup().invoke('create_folder', {
      location: 'desktop/work/2026/notes',
    });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(DESKTOP, 'work', '2026', 'notes'))).toBe(true);
  });

  it('reports success when the folder already exists', async () => {
    const r = setup();
    await r.invoke('create_folder', { location: 'desktop/dup' });
    const res = await r.invoke('create_folder', { location: 'desktop/dup' });

    expect(res.ok).toBe(true);
    if (res.ok) expect(res.content).toMatch(/already exists/i);
  });

  /** The model supplies the path, so escaping the home directory is refused. */
  it('refuses a path outside the user folder', async () => {
    const res = await setup().invoke('create_folder', {
      location: 'C:\\Windows\\System32\\evil',
    });

    expect(res.ok).toBe(false);
    expect(fs.existsSync('C:\\Windows\\System32\\evil')).toBe(false);
  });

  it('refuses traversal', async () => {
    const res = await setup().invoke('create_folder', {
      location: 'desktop/../../../../evil',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects a missing location', async () => {
    expect((await setup().invoke('create_folder', {})).ok).toBe(false);
    expect((await setup().invoke('create_folder', { location: '  ' })).ok).toBe(false);
  });
});

describe('create_file', () => {
  it('writes content to a file', async () => {
    const res = await setup().invoke('create_file', {
      location: 'desktop/essay.txt',
      content: 'Cricket is my favourite sport.',
    });

    expect(res.ok).toBe(true);
    const target = path.join(DESKTOP, 'essay.txt');
    expect(fs.readFileSync(target, 'utf8')).toBe('Cricket is my favourite sport.');
  });

  it('preserves multi-line content exactly', async () => {
    const body = 'Line one\nLine two\n\nLine four';
    await setup().invoke('create_file', { location: 'desktop/multi.txt', content: body });

    expect(fs.readFileSync(path.join(DESKTOP, 'multi.txt'), 'utf8')).toBe(body);
  });

  it('creates missing parent folders', async () => {
    const res = await setup().invoke('create_file', {
      location: 'desktop/reports/q1/summary.txt',
      content: 'hi',
    });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(DESKTOP, 'reports', 'q1', 'summary.txt'))).toBe(true);
  });

  it('opens the file only when asked', async () => {
    const r = setup();
    await r.invoke('create_file', { location: 'desktop/a.txt', content: 'x' });
    expect(openPath).not.toHaveBeenCalled();

    await r.invoke('create_file', { location: 'desktop/b.txt', content: 'x', open: 'yes' });
    expect(openPath).toHaveBeenCalledOnce();
  });

  it('refuses a path outside the user folder', async () => {
    const res = await setup().invoke('create_file', {
      location: 'C:\\Windows\\evil.txt',
      content: 'x',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects missing content', async () => {
    expect((await setup().invoke('create_file', { location: 'desktop/x.txt' })).ok).toBe(
      false,
    );
  });

  it('strips characters Windows forbids from the file name', async () => {
    const res = await setup().invoke('create_file', {
      location: 'desktop/my<>report.txt',
      content: 'x',
    });

    expect(res.ok).toBe(true);
    expect(fs.existsSync(path.join(DESKTOP, 'myreport.txt'))).toBe(true);
  });
});
