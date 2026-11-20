/**
 * Recognises "explain this slide" requests, as opposed to questions.
 *
 *   "Flick, explain this slide"              → the slide on screen
 *   "explain slide 5 to the audience"        → slide 5
 *   "walk us through the next slide"         → the slide after the one on screen
 *   "is slide ko samjhao" / "slide 3 samjha do" (Roman Urdu), "اس سلائیڈ کو سمجھاؤ" (Urdu)
 *
 * A question that merely mentions a slide ("why does slide 3 say the loss is
 * convex?") is NOT a command: it goes through the normal answer cascade. The
 * test is deliberately strict, because explaining a slide aloud when the
 * presenter asked something else would talk over them in front of the room.
 */

export type SlideTarget =
  | { kind: 'current' }
  | { kind: 'number'; number: number }
  | { kind: 'relative'; offset: number };

/** Longest request still treated as a command, in words. */
const MAX_COMMAND_WORDS = 14;

const SLIDE_WORD = /\bslides?\b|سلائیڈ|سلائڈ/;

const EXPLAIN_VERB =
  /\b(explain|describe|summari[sz]e|walk\b.{0,20}\bthrough|go (over|through)|run through|talk\b.{0,20}\b(through|about)|teach|break down|elaborate( on)?|samjh\w*|bata\w*|explain kar\w*)\b|سمجھا|بتا/;

/** Asking for a reason is a question about the slide, not a request to present it. */
const QUESTION_WORDS = /\b(why|how come|kyun|kyon|kiyon)\b|کیوں/;

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

export function parseSlideCommand(text: string): SlideTarget | null {
  const t = normalize(text);
  if (!SLIDE_WORD.test(t) || !EXPLAIN_VERB.test(t) || QUESTION_WORDS.test(t)) return null;
  if (t.split(' ').filter(Boolean).length > MAX_COMMAND_WORDS) return null;

  if (/\b(next|agli|agla)\b.{0,12}\bslide|اگلی/.test(t)) return { kind: 'relative', offset: 1 };
  if (/\b(previous|last|pichli|pichla)\b.{0,12}\bslide|پچھلی/.test(t)) return { kind: 'relative', offset: -1 };

  const n = slideNumber(t);
  if (n !== null) return { kind: 'number', number: n };
  return { kind: 'current' };
}

/** "slide 5", "slide number 5", "the 5th slide", "slide five", "fifth slide". */
function slideNumber(t: string): number | null {
  const digits =
    t.match(/\bslides?\s*(?:number\s*|no\s*|#\s*)?(\d{1,3})\b/) ??
    t.match(/\b(\d{1,3})(?:st|nd|rd|th)?\s+slide\b/);
  if (digits) return Number(digits[1]) || null;

  const word =
    t.match(/\bslides?\s*(?:number\s*)?([a-z]+)\b/) ?? t.match(/\b([a-z]+)\s+slide\b/);
  if (word && NUMBER_WORDS[word[1]]) return NUMBER_WORDS[word[1]];
  return null;
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[“”"'`’،,.!?؟۔:;()\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
