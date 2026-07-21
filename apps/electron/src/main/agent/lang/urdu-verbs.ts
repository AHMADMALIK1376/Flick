import { collapseRepeats } from './normalize';

/**
 * Roman Urdu imperative verb stems, including common vowel-dropped spellings
 * ("kar" / "kr"). Stems rather than whole words, because Roman Urdu spelling
 * varies far too much to enumerate.
 */
const ROMAN_STEMS = [
  'khol', 'khl',      // open
  'kar', 'kr',        // do
  'chala', 'chla',    // run / play
  'dikha', 'dkha',    // show
  'samjha', 'smjha',  // explain
  'bana', 'bna',      // make
  'band', 'bnd',      // close
  'bhej', 'bhj',      // send
  'likh', 'lkh',      // write
  'dekh', 'dkh',      // look
  'bata', 'bta',      // tell
  'sun',              // listen
];

/**
 * Imperative endings that may follow a stem.
 *
 * The empty string is included so a bare stem ("khol", "kar") matches. Matching
 * is stem + suffix rather than prefix-only, which is what stops "sunday" from
 * matching the stem "sun".
 */
const SUFFIXES = ['', 'o', 'do', 'na', 'ao', 'aao', 'ein', 'en', 'ay', 'e', 'iye', 'ye'];

/** Urdu-script imperative verbs, matched whole. */
const SCRIPT_VERBS = new Set([
  'کھولو', 'کھول', 'کرو', 'کر', 'چلاؤ', 'چلا',
  'دکھاؤ', 'دکھا', 'سمجھاؤ', 'سمجھا', 'بناؤ', 'بنا',
  'بند', 'بھیجو', 'بھیج', 'لکھو', 'لکھ', 'بتاؤ', 'بتا',
  'دیکھو', 'دیکھ', 'سنو', 'سن',
]);

/**
 * True if the token is an Urdu imperative verb, in either script.
 */
export function matchesUrduVerb(token: string): boolean {
  if (SCRIPT_VERBS.has(token)) {
    return true;
  }

  const collapsed = collapseRepeats(token);

  return ROMAN_STEMS.some((stem) =>
    SUFFIXES.some((suffix) => collapsed === stem + suffix)
  );
}
