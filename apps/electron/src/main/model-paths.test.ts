import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  resolveModelCacheDir,
  isCustomModelDir,
  describeModelCacheDir,
  readConfigModelDir,
  pickModelDirSource,
  CONFIG_FILENAME,
  MODEL_DIR_ENV,
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

describe('pickModelDirSource', () => {
  it('prefers the environment variable above everything', () => {
    expect(
      pickModelDirSource({
        env: 'E:\\fromEnv',
        configFile: 'D:\\fromConfig',
        setting: 'C:\\fromSettings',
      }),
    ).toEqual({ value: 'E:\\fromEnv', source: MODEL_DIR_ENV });
  });

  /**
   * The whole point of the config file: the settings file is rewritten by the
   * app and by the settings UI, so a value stored only there can be erased by
   * an unrelated save. The config file cannot be.
   */
  it('prefers the config file over the settings file', () => {
    expect(
      pickModelDirSource({ configFile: 'D:\\flickmodel', setting: '' }),
    ).toEqual({ value: 'D:\\flickmodel', source: CONFIG_FILENAME });
  });

  it('still honours the config file when settings were wiped to empty', () => {
    expect(
      pickModelDirSource({ configFile: 'D:\\flickmodel', setting: '' }).value,
    ).toBe('D:\\flickmodel');
  });

  it('falls back to the settings file when no config exists', () => {
    expect(pickModelDirSource({ setting: 'C:\\fromSettings' })).toEqual({
      value: 'C:\\fromSettings',
      source: 'settings',
    });
  });

  it('reports the default when every source is empty', () => {
    expect(pickModelDirSource({})).toEqual({ value: '', source: 'default' });
  });

  it('treats whitespace-only values as absent', () => {
    expect(pickModelDirSource({ env: '   ', configFile: 'D:\\x' }).source).toBe(
      CONFIG_FILENAME,
    );
  });
});

describe('readConfigModelDir', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flick-cfg-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('reads modelCacheDir from the config file', () => {
    fs.writeFileSync(
      path.join(dir, CONFIG_FILENAME),
      JSON.stringify({ modelCacheDir: 'D:\\flickmodel' }),
    );

    expect(readConfigModelDir(dir)).toBe('D:\\flickmodel');
  });

  it('returns null when the file is absent', () => {
    expect(readConfigModelDir(dir)).toBeNull();
  });

  /** A BOM already cost a full debugging session once. */
  it('tolerates a UTF-8 BOM', () => {
    fs.writeFileSync(
      path.join(dir, CONFIG_FILENAME),
      '﻿' + JSON.stringify({ modelCacheDir: 'D:\\flickmodel' }),
      'utf8',
    );

    expect(readConfigModelDir(dir)).toBe('D:\\flickmodel');
  });

  it('returns null for malformed JSON rather than throwing', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILENAME), '{ not json');

    expect(() => readConfigModelDir(dir)).not.toThrow();
    expect(readConfigModelDir(dir)).toBeNull();
  });

  it('searches several locations and uses the first hit', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'flick-cfg2-'));
    try {
      fs.writeFileSync(
        path.join(other, CONFIG_FILENAME),
        JSON.stringify({ modelCacheDir: 'D:\\second' }),
      );

      // Absent in the first directory, found in the second.
      expect(readConfigModelDir(dir, other)).toBe('D:\\second');
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('ignores empty directory arguments', () => {
    fs.writeFileSync(
      path.join(dir, CONFIG_FILENAME),
      JSON.stringify({ modelCacheDir: 'D:\\flickmodel' }),
    );

    expect(readConfigModelDir('', dir)).toBe('D:\\flickmodel');
  });

  it('returns null when the key is missing or blank', () => {
    fs.writeFileSync(path.join(dir, CONFIG_FILENAME), JSON.stringify({}));
    expect(readConfigModelDir(dir)).toBeNull();

    fs.writeFileSync(
      path.join(dir, CONFIG_FILENAME),
      JSON.stringify({ modelCacheDir: '   ' }),
    );
    expect(readConfigModelDir(dir)).toBeNull();
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
