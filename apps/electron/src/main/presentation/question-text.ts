/**
 * Turns a raw transcript into the question to answer.
 *
 * The presenter usually addresses Flick by name — "Flick, what is
 * backpropagation?" — and Whisper often writes the name as "flix" or "flik".
 * The address is dropped so it does not end up inside the question.
 */

const ADDRESS = /^\s*(?:(?:hey|hi|hello|ok|okay|yo)[\s,]+)?(?:flick|flik|flix|flicks|flick's)\b[\s,.:;!?-]*/i;

/**
 * Whisper's well-known outputs for silence or a cough. Treated as "nothing was
 * heard" rather than sent off as a question.
 */
const SILENCE_HALLUCINATIONS = new Set([
  '',
  'you',
  'thank you',
  'thanks',
  'thank you for watching',
  'thanks for watching',
  'bye',
  'blank audio',
  'music',
  'silence',
]);

export function cleanQuestion(transcript: string): string {
  const q = transcript.replace(ADDRESS, '').replace(/\s+/g, ' ').trim();
  // Removing "Flick," leaves a lowercase start; the card reads better capitalised.
  return q.charAt(0).toUpperCase() + q.slice(1);
}

/** True when the presenter said Flick's name and nothing else. */
export function isBareAddress(transcript: string): boolean {
  return ADDRESS.test(transcript) && cleanQuestion(transcript).replace(/[^\p{L}\p{N}]/gu, '') === '';
}

/** True when the transcript is empty or one of Whisper's silence artefacts. */
export function isNothingHeard(transcript: string): boolean {
  const normalized = transcript
    .toLowerCase()
    .replace(/[\[\]().,!?'"-]/g, ' ')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return SILENCE_HALLUCINATIONS.has(normalized);
}
