// What Flick says out loud for each live event. Pure: easy to test.
//
// - A new question stops whatever is being said.
// - "searching" with speak → a short "One moment" so the room isn't silent.
// - Streamed sentences are said as they arrive.
// - A whole answer that was NOT streamed (prepared answers, ready slide explanations) is said at the end.
// - Errors and greetings are never spoken.
import type { Answer, FlickEventMap } from '../../api/types';

export type SpeechStep = { cancel: true } | { say: string } | null;

export const ONE_MOMENT = 'One moment, let me check.';

export function speechFor(event: { type: 'thinking'; data: FlickEventMap['thinking'] }): SpeechStep;
export function speechFor(event: { type: 'searching'; data: FlickEventMap['searching'] }): SpeechStep;
export function speechFor(event: { type: 'answer_delta'; data: FlickEventMap['answer_delta'] }): SpeechStep;
export function speechFor(event: { type: 'answer'; data: Answer }): SpeechStep;
export function speechFor(
  event:
    | { type: 'thinking'; data: FlickEventMap['thinking'] }
    | { type: 'searching'; data: FlickEventMap['searching'] }
    | { type: 'answer_delta'; data: FlickEventMap['answer_delta'] }
    | { type: 'answer'; data: Answer },
): SpeechStep {
  switch (event.type) {
    case 'thinking':
      return { cancel: true };
    case 'searching':
      return event.data.speak ? { say: ONE_MOMENT } : null;
    case 'answer_delta':
      return event.data.speak && event.data.text.trim() ? { say: event.data.text } : null;
    case 'answer': {
      const a = event.data;
      if (!a.speak || a.streamed || a.origin === 'error' || a.origin === 'greeting') return null;
      return a.answer.trim() ? { say: a.answer } : null;
    }
  }
}
