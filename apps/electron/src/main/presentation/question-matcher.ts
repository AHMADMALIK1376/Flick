import type { PredictedQuestion } from '../../shared/types';

/**
 * Instant, offline matching of a live question against the questions prepared
 * before the talk. When it is confident, Flick answers with no model call at
 * all — the fastest possible reply in front of an audience.
 *
 * This is deliberately conservative: a near-miss costs only a model call (the
 * prepared answers are in the model's context anyway), but a wrong match reads
 * the wrong answer to a room full of people.
 */

/** Similarity at or above which a prepared answer is used directly. */
export const MATCH_THRESHOLD = 0.72;

/**
 * Filler words that carry no meaning for matching. Question words (what, why,
 * how…) are intentionally NOT here: "what is X" and "why use X" need
 * different answers.
 */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'do', 'does', 'did', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from',
  'and', 'or', 'but', 'it', 'its', 'this', 'that', 'these', 'those', 'there',
  'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might', 'must',
  'you', 'your', 'we', 'our', 'i', 'me', 'my', 'us', 'they', 'them', 'their',
  'please', 'tell', 'explain', 'about', 'some', 'any', 'just', 'so', 'also',
  'really', 'actually', 'basically', 'mean', 'means', 'like', 'kind', 'sort',
  'into', 'as', 'if', 'then', 'than', 'have', 'has', 'had', 'get', 'got',
]);

/** Crude suffix stripping, enough for "networks"/"network", "training"/"train". */
function stem(word: string): string {
  if (word.length > 5 && word.endsWith('ing')) return word.slice(0, -3);
  if (word.length > 4 && word.endsWith('ed')) return word.slice(0, -2);
  if (word.length > 4 && word.endsWith('es')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function contentTokens(text: string): Set<string> {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)).map(stem));
}

/** Cosine similarity of two token sets, 0–1. */
export function similarity(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;

  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;

  // One shared word between two longer questions is coincidence, not a match.
  if (shared < 2 && Math.min(ta.size, tb.size) > 2) return 0;

  return shared / Math.sqrt(ta.size * tb.size);
}

export interface MatchResult {
  item: PredictedQuestion;
  score: number;
}

export function findBestMatch(
  question: string,
  items: PredictedQuestion[],
  threshold = MATCH_THRESHOLD,
): MatchResult | null {
  let best: MatchResult | null = null;
  for (const item of items) {
    const score = similarity(question, item.question);
    if (!best || score > best.score) best = { item, score };
  }
  return best && best.score >= threshold ? best : null;
}
