/**
 * A service Flick can log into and later act on through the browser agent.
 *
 * Logging in happens once, in a real browser window the user drives. The
 * session is saved in the shared browser profile, so browser_task reuses it.
 */
export interface Connector {
  id: string;
  name: string;
  /** Page opened for login. Redirects to a sign-in form when not logged in. */
  homeUrl: string;
  /** Emoji shown in the UI. */
  icon: string;
}

/**
 * Built-in connectors. Google sign-in is shared across Gmail and YouTube, so
 * connecting one effectively connects the others — that is expected, not a bug.
 */
export const BUILTIN_CONNECTORS: readonly Connector[] = [
  { id: 'gmail', name: 'Gmail', homeUrl: 'https://mail.google.com', icon: '📧' },
  { id: 'google', name: 'Google', homeUrl: 'https://www.google.com', icon: '🔍' },
  { id: 'youtube', name: 'YouTube', homeUrl: 'https://www.youtube.com', icon: '▶️' },
  { id: 'spotify', name: 'Spotify', homeUrl: 'https://open.spotify.com', icon: '🎵' },
  { id: 'netflix', name: 'Netflix', homeUrl: 'https://www.netflix.com', icon: '🎬' },
];

export function getConnector(id: string): Connector | undefined {
  return BUILTIN_CONNECTORS.find((c) => c.id === id);
}

/**
 * Builds an ad-hoc connector for an arbitrary URL the user wants to sign into,
 * so "connect this site" works beyond the built-in list. The id is the
 * hostname, so revisiting the same site reuses the same connector.
 *
 * Returns null for anything that is not a valid http(s) URL.
 */
export function connectorForUrl(rawUrl: string): Connector | null {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '');
  const known = BUILTIN_CONNECTORS.find((c) => {
    try {
      return new URL(c.homeUrl).hostname.replace(/^www\./, '') === host;
    } catch {
      return false;
    }
  });
  if (known) return known;

  return {
    id: host,
    name: host,
    homeUrl: url.origin,
    icon: '🌐',
  };
}
