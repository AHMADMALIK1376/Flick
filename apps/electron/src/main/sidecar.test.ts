import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { freePort, launchPlan, parseReady, pythonCommand } from './sidecar';
import { toAccelerator } from './hotkey-format';

describe('parseReady', () => {
  it('reads the port', () => expect(parseReady('FLICK_READY 8765')).toBe(8765));
  it('allows Windows line endings', () => expect(parseReady('FLICK_READY 51234\r')).toBe(51234));
  it('ignores other lines', () => {
    expect(parseReady('INFO: started')).toBeNull();
    expect(parseReady('FLICK_READY')).toBeNull();
  });
});

describe('pythonCommand', () => {
  it('uses python on Windows', () => expect(pythonCommand('win32', {})).toBe('python'));
  it('uses python3 elsewhere', () => expect(pythonCommand('linux', {})).toBe('python3'));
  it('FLICK_PYTHON overrides', () => expect(pythonCommand('win32', { FLICK_PYTHON: 'C:\\venv\\python.exe' })).toBe('C:\\venv\\python.exe'));
});

describe('launchPlan', () => {
  it('runs python -m flick from backend/ in development', () => {
    const plan = launchPlan({ packaged: false, resourcesPath: '', repoRoot: '/repo', platform: 'linux', env: {}, port: 9000 });
    expect(plan).toEqual({ command: 'python3', args: ['-m', 'flick', '--port', '9000'], cwd: path.join('/repo', 'backend') });
  });
  it('runs the bundled exe when installed', () => {
    const plan = launchPlan({ packaged: true, resourcesPath: '/res', repoRoot: '', platform: 'win32', env: {}, port: 9000 });
    expect(plan.command).toBe(path.join('/res', 'backend', 'flick-backend.exe'));
    expect(plan.args).toEqual(['--port', '9000']);
  });
});

describe('freePort', () => {
  it('returns a usable port', async () => {
    const port = await freePort();
    expect(port).toBeGreaterThan(0);
  });
});

describe('toAccelerator', () => {
  it('keeps Electron names', () => expect(toAccelerator('Ctrl+Shift+Space')).toBe('Ctrl+Shift+Space'));
  it('trims spaces', () => expect(toAccelerator(' Ctrl + Shift + E ')).toBe('Ctrl+Shift+E'));
  it('empty → null', () => expect(toAccelerator('')).toBeNull());
});
