import * as path from 'path';

/** Subdirectory used when no custom model location is configured. */
const DEFAULT_SUBDIR = path.join('models', 'onnx');

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
