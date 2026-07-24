/**
 * Spoken greeting for when Flick is addressed by name with no command —
 * "Flick" on its own, the way you'd say "Hey Siri" and wait.
 */

/** Words that mean the user addressed Flick but gave no actual command. */
const BARE_ADDRESS = new Set([
  'flick',
  'flik',
  'flix',
  'hey flick',
  'hey flik',
  'hey flix',
  'ok flick',
  'okay flick',
  'hello flick',
  'hi flick',
]);

/**
 * True when the utterance is just an address to Flick with nothing to do —
 * "flick", "hey flick" — so she should greet rather than try to act.
 *
 * Punctuation and casing are ignored; anything with a real command after the
 * name ("flick open notepad") is not a bare address.
 */
export function isBareAddress(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return BARE_ADDRESS.has(normalized);
}

/** Time-of-day salutation for the given hour (0–23). */
export function salutation(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Ordinal suffix for a day of the month: 1 → "st", 22 → "nd", 11 → "th". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/**
 * Builds the spoken greeting, e.g.
 * "Good evening, boss. It's 9:40 PM, Tuesday the 21st. What can I do for you?"
 */
export function buildGreeting(now: Date): string {
  const hour = now.getHours();
  const minute = now.getMinutes();

  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const mm = minute.toString().padStart(2, '0');
  const ampm = hour < 12 ? 'AM' : 'PM';

  const day = DAYS[now.getDay()];
  const date = now.getDate();

  return (
    `${salutation(hour)}, boss. ` +
    `It's ${h12}:${mm} ${ampm}, ${day} the ${date}${ordinal(date)}. ` +
    `What can I do for you?`
  );
}
