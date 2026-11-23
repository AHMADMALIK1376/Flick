// Where the backend is and the token to use.
//
// - In Electron: the app opens this UI with ?port=...&token=... in the URL.
// - In the browser (npm run dev): values come from .env.local (see .env.example).

function fromUrl(name: string): string | null {
  const search = new URLSearchParams(window.location.search);
  if (search.has(name)) return search.get(name);
  // With HashRouter the query can also sit after the '#': #/card?port=...
  const hashQuery = window.location.hash.split('?')[1];
  return hashQuery ? new URLSearchParams(hashQuery).get(name) : null;
}

const port = fromUrl('port') ?? import.meta.env.VITE_FLICK_PORT ?? '8765';
const token = fromUrl('token') ?? import.meta.env.VITE_FLICK_TOKEN ?? 'flick-dev';

export const connection = {
  token,
  httpBase: `http://127.0.0.1:${port}`,
  wsUrl: `ws://127.0.0.1:${port}/events?token=${encodeURIComponent(token)}`,
};
