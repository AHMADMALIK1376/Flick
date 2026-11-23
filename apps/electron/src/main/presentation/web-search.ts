/**
 * Web search for providers that have none built in.
 *
 * Claude searches the web itself, so with Claude this is never used. With any
 * other provider, Flick calls the Tavily search API (free tier available at
 * tavily.com) and has the model answer from the results.
 */

export interface WebResult {
  title: string;
  url: string;
  content: string;
}

export type SearchOutcome = { ok: true; results: WebResult[] } | { ok: false; error: string };

const TAVILY_URL = 'https://api.tavily.com/search';
const TIMEOUT_MS = 15_000;
const MAX_RESULTS = 5;
/** Characters of each result passed to the model — snippets, not whole pages. */
const MAX_CONTENT_CHARS = 1_200;

export async function tavilySearch(
  apiKey: string,
  query: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SearchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetchImpl(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, max_results: MAX_RESULTS, search_depth: 'basic' }),
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        error: res.status === 401 ? 'The Tavily API key was rejected.' : `Web search failed (HTTP ${res.status}).`,
      };
    }
    const data = (await res.json()) as { results?: Array<Partial<WebResult>> };
    const results = (data.results ?? [])
      .filter((r) => typeof r.url === 'string')
      .map((r) => ({
        title: String(r.title || r.url),
        url: String(r.url),
        content: String(r.content ?? '').slice(0, MAX_CONTENT_CHARS),
      }));
    return { ok: true, results };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, error: aborted ? 'Web search timed out.' : `Web search failed: ${String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

/** Search results as prompt text for the model to answer from. */
export function formatResults(results: WebResult[]): string {
  return (
    '<web_results>\n' +
    results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.content}`).join('\n\n') +
    '\n</web_results>'
  );
}
