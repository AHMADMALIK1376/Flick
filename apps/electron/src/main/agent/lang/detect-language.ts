import { normalize } from './normalize';
import type { LanguageHint } from '../../../shared/types';

export type { LanguageHint };

/** Arabic block, which covers the Urdu alphabet. */
const URDU_SCRIPT = /[؀-ۿ]/;

const LATIN = /[a-z]/;

/**
 * High-frequency Roman Urdu words with no common English collision.
 *
 * Deliberately excludes "do", "main", "hai", "to", "be" — all frequent in Urdu
 * but indistinguishable from ordinary English words in a code-switched sentence.
 */
const ROMAN_URDU_MARKERS = new Set([
  'karo', 'kro', 'kar', 'kre', 'karna',
  'kholo', 'khol', 'kholna',
  'mera', 'meri', 'mere', 'mujhe', 'mujhko',
  'aap', 'aapka', 'tum', 'tumhara',
  'kya', 'kyun', 'kaise', 'kahan', 'kab',
  'aur', 'phir', 'abhi', 'jaldi',
  'nahi', 'nahin', 'haan',
  'batao', 'bata', 'dikhao', 'dikha',
  'samjhao', 'samjha', 'banao', 'bana',
  'chalao', 'chala', 'bhejo', 'bhej',
  'wala', 'wali', 'sath', 'liye',
]);

export function hasUrduScript(text: string): boolean {
  return URDU_SCRIPT.test(text);
}

export function detectLanguage(text: string): LanguageHint {
  const normalized = normalize(text);

  if (!normalized) {
    return 'en';
  }

  const urdu = hasUrduScript(normalized);
  const latin = LATIN.test(normalized);

  if (urdu && latin) {
    return 'mixed';
  }
  if (urdu) {
    return 'ur';
  }

  const tokens = normalized.split(' ');
  if (tokens.some((token) => ROMAN_URDU_MARKERS.has(token))) {
    return 'roman-ur';
  }

  return 'en';
}
