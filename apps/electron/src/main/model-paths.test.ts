import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveModelCacheDir, isCustomModelDir } from './model-paths';

const USER_DATA = path.join('C:', 'Users', 'hp', 'AppData', 'Roaming', 'Electron');
const DEFAULT_DIR = path.join(USER_DATA, 'models', 'onnx');

describe('resolveModelCacheDir', () => {
  it('uses an absolute custom path', () => {
    expect(resolveModelCacheDir('D:\\flickmodel', USER_DATA)).toBe('D:\\flickmodel');
  });

  it('falls back to user data when unset', () => {
    expect(resolveModelCacheDir('', USER_DATA)).toBe(DEFAULT_DIR);
    expect(resolveModelCacheDir(undefined, USER_DATA)).toBe(DEFAULT_DIR);
    expect(resolveModelCacheDir(null, USER_DATA)).toBe(DEFAULT_DIR);
  });

  it('ignores surrounding whitespace', () => {
    expect(resolveModelCacheDir('  D:\\flickmodel  ', USER_DATA)).toBe('D:\\flickmodel');
  });

  it('treats a whitespace-only value as unset', () => {
    expect(resolveModelCacheDir('   ', USER_DATA)).toBe(DEFAULT_DIR);
  });

  /**
   * A relative path would otherwise resolve against whatever the working
   * directory happens to be, putting a 1.5GB download somewhere unexpected.
   */
  it('rejects a relative path rather than resolving it somewhere surprising', () => {
    expect(resolveModelCacheDir('flickmodel', USER_DATA)).toBe(DEFAULT_DIR);
    expect(resolveModelCacheDir('..\\models', USER_DATA)).toBe(DEFAULT_DIR);
  });
});

describe('isCustomModelDir', () => {
  it('is true for an absolute custom path', () => {
    expect(isCustomModelDir('D:\\flickmodel', USER_DATA)).toBe(true);
  });

  it('is false when unset', () => {
    expect(isCustomModelDir('', USER_DATA)).toBe(false);
  });

  it('is false for a rejected relative path', () => {
    expect(isCustomModelDir('flickmodel', USER_DATA)).toBe(false);
  });
});
