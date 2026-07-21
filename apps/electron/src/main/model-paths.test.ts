import { describe, it, expect } from 'vitest';
import * as path from 'path';
import {
  resolveModelCacheDir,
  isCustomModelDir,
  describeModelCacheDir,
} from './model-paths';

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

describe('describeModelCacheDir', () => {
  it('names the setting as the source for an absolute path', () => {
    const text = describeModelCacheDir('D:\\flickmodel', USER_DATA);
    expect(text).toContain('D:\\flickmodel');
    expect(text).toMatch(/setting/i);
  });

  it('says default when unconfigured', () => {
    expect(describeModelCacheDir('', USER_DATA)).toMatch(/default/i);
  });

  /**
   * A rejected relative path previously looked identical to no setting at
   * all, which is what made a misconfiguration invisible until 1.5GB had
   * downloaded to the wrong drive.
   */
  it('says a relative path was ignored, not merely that the default applies', () => {
    const text = describeModelCacheDir('flickmodel', USER_DATA);
    expect(text).toMatch(/ignoring relative/i);
    expect(text).toContain('flickmodel');
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
