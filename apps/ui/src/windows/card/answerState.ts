// Issue #8 · Design screen: L2
//
// State of the answer card, changed by live events. Pure function: easy to test.

import type { Answer } from '../../api/types';

export type CardState =
  | { phase: 'hidden' }
  | { phase: 'listening' }
  | { phase: 'thinking'; id: string; question: string }
  | { phase: 'searching'; id: string; question: string }
  | { phase: 'streaming'; id: string; question: string; text: string }
  | { phase: 'answer'; answer: Answer }
  | { phase: 'error'; message: string };

export type CardAction =
  | { type: 'listening' }
  | { type: 'thinking'; id: string; question: string }
  | { type: 'searching'; id: string }
  | { type: 'delta'; id: string; text: string }
  | { type: 'answer'; answer: Answer }
  | { type: 'hide' };

export const initialCardState: CardState = { phase: 'hidden' };

export function answerReducer(state: CardState, action: CardAction): CardState {
  // TODO(#8): handle every action. Ignore events whose id is not the current one.
  switch (action.type) {
    case 'hide':
      return { phase: 'hidden' };
    default:
      return state;
  }
}
