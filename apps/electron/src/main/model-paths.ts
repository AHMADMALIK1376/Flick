import * as path from 'path';
import * as fs from 'fs';

/** Subdirectory used when no custom model location is configured. */
const DEFAULT_SUBDIR = path.join('models', 'onnx');

/** Read-only config file, sitting beside the app. Never written by the app. */
export const CONFIG_FILENAME = 'flick.config.json';

/** Environment variable override, highest precedence of all. */
export const MODEL_DIR_ENV = 'FLICK_MODEL_DIR';
export const BROWSER_DIR_ENV = 'FLICK_BROWSER_DIR';

/**
 * Reads the model directory from the read-only config file, if present.
 *
 * The settings file is rewritten by the app and by the settings UI, so a value
 * stored only there can be erased by an unrelated save. Anything that must
 * survive that belongs here instead: this file is read and never written.
 *
 * Returns null when absent or unreadable — a broken config falls through to
 * the next source rather than stopping the app from starting.
 */
export function readConfigModelDir(...searchDirs: string[]): string | null {
  return readConfigKey('modelCacheDir', searchDirs);
}

/** Reads the browser-profile directory from the read-only config file. */
export function readConfigBrowserDir(...searchDirs: string[]): string | null {
  return readConfigKey('browserDataDir', searchDirs);
}

/**
 * Reads one string key from flick.config.json, searching each directory in
 * turn. Returns the first non-empty value, or null. A missing file, malformed
 * JSON, or BOM never throws — it falls through to the next location.
 */
export function readConfigKey(
  key: string,
  searchDirs: string[],
): string | null {
  for (const dir of searchDirs) {
    if (!dir) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, CONFIG_FILENAME), 'utf8');
      const parsed = JSON.parse(raw.replace(/^﻿/, '')) as Record<string, unknown>;
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
    } catch {
      // Missing or malformed here; try the next location.
    }
  }
  return null;
}

/**
 * Picks the model directory from every source, highest precedence first:
 * environment variable, read-only config file, then the settings file.
 */
export function pickModelDirSource(sources: {
  env?: string | null;
  configFile?: string | null;
  setting?: string | null;
}): { value: string; source: string } {
  const env = (sources.env ?? '').trim();
  if (env) return { value: env, source: MODEL_DIR_ENV };

  const config = (sources.configFile ?? '').trim();
  if (config) return { value: config, source: CONFIG_FILENAME };

  const setting = (sources.setting ?? '').trim();
  if (setting) return { value: setting, source: 'settings' };

  return { value: '', source: 'default' };
}

/**
 * Decides where Whisper model files live.
 *
 * Models are ~1.5GB, which is a poor fit for the OS user-data directory on a
 * machine whose system drive is short on space. This lets the model store be
 * pointed at any drive while settings and history stay in the conventional
 * per-user location, where the platform expects them.
 *
 * A relative path falls back to the default rather than being resolved against
 * some implicit working directory — a model store that silently lands
 * somewhere unexpected is worse than one that ignores a malformed setting.
 */
export function resolveModelCacheDir(
  configured: string | null | undefined,
  userDataDir: string
): string {
  const trimmed = (configured ?? '').trim();

  if (!trimmed || !path.isAbsolute(trimmed)) {
    return path.join(userDataDir, DEFAULT_SUBDIR);
  }

  return trimmed;
}

/**
 * Human-readable explanation of where models will be stored and why.
 *
 * Logged on startup because a misconfigured location is otherwise invisible
 * until a 1.5GB download has already landed on the wrong drive.
 */
export function describeModelCacheDir(
  configured: string | null | undefined,
  userDataDir: string
): string {
  const resolved = resolveModelCacheDir(configured, userDataDir);
  const trimmed = (configured ?? '').trim();

  if (!trimmed) {
    return `${resolved} (default — no modelCacheDir configured)`;
  }
  if (!path.isAbsolute(trimmed)) {
    return `${resolved} (default — ignoring relative modelCacheDir "${trimmed}")`;
  }
  return `${resolved} (from modelCacheDir setting)`;
}

/** True when a custom location is in effect rather than the default. */
export function isCustomModelDir(
  configured: string | null | undefined,
  userDataDir: string
): boolean {
  return (
    resolveModelCacheDir(configured, userDataDir) !==
    path.join(userDataDir, DEFAULT_SUBDIR)
  );
}
