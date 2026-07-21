/**
 * Ways Whisper renders the assistant's name.
 *
 * "Flick" is routinely transcribed as "flix" or "flik", so matching only the
 * correct spelling would miss most real utterances.
 */
const NAMES = new Set(['flick', 'flik', 'flix', 'flicks', 'flick\'s']);

/**
 * Fillers that commonly precede or follow the name.
 *
 * Includes polite-request words ("can you please..."). These are only ever
 * stripped when the assistant is addressed by name, so widening this list does
 * not make ordinary prose like "we need to open the discussion" look like a
 * command — that phrasing never reaches here.
 */
const FILLERS = new Set([
  'hey', 'ok', 'okay', 'hi', 'hello', 'yo',
  'please', 'plz', 'can', 'could', 'would', 'will', 'you', 'kindly',
]);

/**
 * Drops a leading address to the assistant — "flick,", "hey flick", "ok flick
 * please" — so the command verb moves to the front of the utterance.
 *
 * Without this, naming the assistant pushes the verb past the detector's
 * lookahead window and the command is silently treated as dictation.
 *
 * Only strips when the assistant's name is actually present. Bare fillers are
 * left alone, since "hello world" is dictation, not a truncated command.
 */
export function stripWakeWord(tokens: string[]): string[] {
  const nameAt = tokens.findIndex((t) => NAMES.has(t));

  // The name must appear near the start to count as an address rather than
  // an ordinary mention ("type flick into the box").
  if (nameAt === -1 || nameAt > 2) {
    return tokens;
  }

  // Everything before the name must be filler, otherwise it is real content.
  if (!tokens.slice(0, nameAt).every((t) => FILLERS.has(t))) {
    return tokens;
  }

  let i = nameAt + 1;
  while (i < tokens.length && FILLERS.has(tokens[i])) {
    i++;
  }

  const remainder = tokens.slice(i);

  // "flick" alone is an address with no command; keep the original so it is
  // handled as dictation rather than becoming an empty utterance.
  return remainder.length > 0 ? remainder : tokens;
}
