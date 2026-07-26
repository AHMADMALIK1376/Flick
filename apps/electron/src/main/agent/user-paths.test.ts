import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveUserPath, sanitizeName, wellKnownFolders } from './user-paths';

const HOME = path.resolve('C:\\Users\\testuser');
const DESKTOP = path.join(HOME, 'Desktop');

describe('wellKnownFolders', () => {
  it('maps spoken folder names under the given home', () => {
    const f = wellKnownFolders(HOME);
    expect(f.desktop).toBe(DESKTOP);
    expect(f.documents).toBe(path.join(HOME, 'Documents'));
  });
});

describe('resolveUserPath', () => {
  it('resolves a bare well-known folder', () => {
    expect(resolveUserPath('desktop', HOME)).toEqual({ ok: true, path: DESKTOP });
  });

  it('resolves a folder plus a subpath', () => {
    expect(resolveUserPath('desktop/secret project', HOME)).toEqual({
      ok: true,
      path: path.join(DESKTOP, 'secret project'),
    });
  });

  it('accepts backslashes as separators', () => {
    expect(resolveUserPath('documents\\notes', HOME).ok).toBe(true);
    expect(
      (resolveUserPath('documents\\notes', HOME) as { path: string }).path,
    ).toBe(path.join(HOME, 'Documents', 'notes'));
  });

  it('is case-insensitive about the folder name', () => {
    expect((resolveUserPath('Desktop/X', HOME) as { path: string }).path).toBe(
      path.join(DESKTOP, 'X'),
    );
  });

  /**
   * A spoken "create a folder called secret project" names no location; the
   * desktop is the most likely intent.
   */
  it('defaults an unqualified name to the desktop', () => {
    expect((resolveUserPath('secret project', HOME) as { path: string }).path).toBe(
      path.join(DESKTOP, 'secret project'),
    );
  });

  it('accepts an absolute path inside home', () => {
    const target = path.join(HOME, 'Documents', 'ok');
    expect(resolveUserPath(target, HOME)).toEqual({ ok: true, path: target });
  });

  // ── Safety: the model supplies this string, so it is untrusted ──

  it('refuses traversal escaping home', () => {
    const r = resolveUserPath('desktop/../../../Windows/System32', HOME);
    expect(r.ok).toBe(false);
  });

  it('refuses an absolute path outside home', () => {
    expect(resolveUserPath('C:\\Windows\\System32', HOME).ok).toBe(false);
    expect(resolveUserPath('C:\\', HOME).ok).toBe(false);
  });

  it('refuses empty input', () => {
    expect(resolveUserPath('', HOME).ok).toBe(false);
    expect(resolveUserPath('   ', HOME).ok).toBe(false);
  });

  it('explains why a refusal happened', () => {
    const r = resolveUserPath('C:\\Windows', HOME);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/outside your user folder/i);
  });

  it('allows home itself', () => {
    expect(resolveUserPath('home', HOME)).toEqual({ ok: true, path: HOME });
  });
});

describe('sanitizeName', () => {
  it('strips characters Windows forbids', () => {
    expect(sanitizeName('my<>:"/\\|?*project')).toBe('myproject');
  });

  it('collapses whitespace', () => {
    expect(sanitizeName('  secret   project  ')).toBe('secret project');
  });

  it('strips trailing dots and spaces Windows rejects', () => {
    expect(sanitizeName('project...')).toBe('project');
    expect(sanitizeName('project   ')).toBe('project');
  });

  it('keeps ordinary names intact', () => {
    expect(sanitizeName('Secret Project 2026')).toBe('Secret Project 2026');
  });

  it('returns empty for junk-only input', () => {
    expect(sanitizeName('///')).toBe('');
  });
});
