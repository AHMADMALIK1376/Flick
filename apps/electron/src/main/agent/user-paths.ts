import * as path from 'path';
import * as os from 'os';

/**
 * Well-known folders a spoken command can name, e.g. "on my desktop".
 */
export function wellKnownFolders(home: string = os.homedir()): Record<string, string> {
  return {
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    'my documents': path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    pictures: path.join(home, 'Pictures'),
    music: path.join(home, 'Music'),
    videos: path.join(home, 'Videos'),
    home: home,
  };
}

export type PathResolution =
  | { ok: true; path: string }
  | { ok: false; error: string };

/**
 * Turns a spoken location into an absolute path, confined to the user's home.
 *
 * Accepts "desktop", "desktop/secret project", "documents\\notes", or an
 * absolute path already inside home. The model supplies this string, so it is
 * treated as untrusted: the result must resolve inside the home directory, or
 * it is refused. That blocks traversal ("desktop/../../Windows") and writes to
 * system locations, which a misheard command could otherwise trigger.
 */
export function resolveUserPath(
  input: string,
  home: string = os.homedir(),
): PathResolution {
  const raw = (input ?? '').trim();
  if (!raw) {
    return { ok: false, error: 'No location given.' };
  }

  // Normalise separators so "desktop\\x" and "desktop/x" behave alike.
  const unified = raw.replace(/\\/g, '/');
  const folders = wellKnownFolders(home);

  let candidate: string;
  if (path.isAbsolute(raw)) {
    candidate = raw;
  } else {
    const [first, ...rest] = unified.split('/').filter(Boolean);
    const base = folders[first.toLowerCase()];
    if (base) {
      candidate = path.join(base, ...rest);
    } else {
      // Unqualified name: put it on the desktop, the most likely intent for a
      // spoken "create a folder called X".
      candidate = path.join(folders.desktop, ...unified.split('/').filter(Boolean));
    }
  }

  const resolved = path.resolve(candidate);
  const homeResolved = path.resolve(home);

  // Confine to home. relative() escaping with '..' means it is outside.
  const rel = path.relative(homeResolved, resolved);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return {
      ok: false,
      error: `Refused: "${raw}" resolves outside your user folder (${resolved}).`,
    };
  }

  return { ok: true, path: resolved };
}

/** Strips characters Windows forbids in a file or folder name. */
export function sanitizeName(name: string): string {
  return (name ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows rejects trailing dots and spaces
}
