/** Urdu/Arabic combining marks (harakat) and the tatweel elongation character. */
const DIACRITICS = /[ً-ْٰـ]/g;

/**
 * Canonical form used by all language matching: lowercase, no diacritics,
 * no punctuation, single-spaced.
 *
 * Urdu script is preserved — \p{L} covers it.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(DIACRITICS, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Squashes runs of a repeated character to a single occurrence.
 *
 * Applied ONLY on the Roman Urdu stem-matching path. English matching must see
 * original spelling, since this would turn "assignment" into "asignment".
 */
export function collapseRepeats(text: string): string {
  return text.replace(/(.)\1+/gu, '$1');
}
