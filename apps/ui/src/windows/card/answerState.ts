// Issue #8 · Design screen: L2
//
// State of the answer card, changed by live events. Pure function: easy to test.
import type { Answer } from '../../api/types';

export type CardState =
  | { phase: 'hidden' } // shown as the "Waiting" view
  | { phase: 'listening' }
  | { phase: 'thinking'; id: string; question: string }
  | { phase: 'searching'; id: string; question: string }
  | { phase: 'streaming'; id: string; question: string; text: string; searched: boolean }
  | { phase: 'answer'; answer: Answer }
  | { phase: 'error'; id: string; question: string; message: string };

export type CardAction =
  | { type: 'listening' }
  | { type: 'thinking'; id: string; question: string }
  | { type: 'searching'; id: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'answer'; answer: Answer }
  | { type: 'hide' };

export const initialCardState: CardState = { phase: 'hidden' };

/** The id of the question the card is working on right now, if any. */
function workingId(state: CardState): string | null {
  return state.phase === 'thinking' || state.phase === 'searching' || state.phase === 'streaming' ? state.id : null;
}

export function answerReducer(state: CardState, action: CardAction): CardState {
  switch (action.type) {
    case 'listening':
      return { phase: 'listening' };

    case 'thinking':
      // A new question always replaces whatever was shown.
      return { phase: 'thinking', id: action.id, question: action.question };

    case 'searching':
      if (state.phase === 'thinking' && state.id === action.id) {
        return { phase: 'searching', id: state.id, question: state.question };
      }
      if (state.phase === 'streaming' && state.id === action.id) {
        return { ...state, searched: true };
      }
      return state;

    case 'delta': {
      if (workingId(state) !== action.id) return state; // a sentence from an older answer
      if (state.phase === 'streaming') {
        return { ...state, text: state.text ? `${state.text} ${action.text}` : action.text };
      }
      if (state.phase === 'thinking' || state.phase === 'searching') {
        return {
          phase: 'streaming',
          id: state.id,
          question: state.question,
          text: action.text,
          searched: state.phase === 'searching',
        };
      }
      return state;
    }

    case 'answer': {
      const { answer } = action;
      // While working on a question, ignore a late answer to an OLDER question.
      // A fresh answer (prepared, or a ready slide explanation) is always shown.
      const current = workingId(state);
      if (current && current !== answer.id && !isFresh(answer)) return state;
      if (answer.origin === 'error') {
        return { phase: 'error', id: answer.id, question: answer.question, message: answer.answer };
      }
      return { phase: 'answer', answer };
    }

    case 'hide':
      return { phase: 'hidden' };
  }
}

// answer.timestamp = when its question started (seconds). Fresh = started in the last 2 s.
function isFresh(answer: Answer): boolean {
  return Date.now() / 1000 - answer.timestamp < 2;
}
