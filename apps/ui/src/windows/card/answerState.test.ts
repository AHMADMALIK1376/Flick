import { describe, expect, it } from 'vitest';
import type { Answer } from '../../api/types';
import { answerReducer, initialCardState, type CardAction, type CardState } from './answerState';

function answer(over: Partial<Answer> = {}): Answer {
  return {
    id: 'a1',
    question: 'What is RLS?',
    answer: 'Row level security.',
    origin: 'slides',
    sources: [],
    current_slide: 2,
    duration_ms: 900,
    timestamp: Date.now() / 1000,
    speak: true,
    streamed: true,
    ...over,
  };
}

function run(actions: CardAction[], start: CardState = initialCardState): CardState {
  return actions.reduce(answerReducer, start);
}

describe('answerReducer', () => {
  it('thinking → deltas → answer', () => {
    const s = run([
      { type: 'thinking', id: 'a1', question: 'What is RLS?' },
      { type: 'delta', id: 'a1', text: 'Row level' },
      { type: 'delta', id: 'a1', text: 'security.' },
    ]);
    expect(s).toMatchObject({ phase: 'streaming', text: 'Row level security.' });
    const done = answerReducer(s, { type: 'answer', answer: answer() });
    expect(done).toMatchObject({ phase: 'answer', answer: { id: 'a1' } });
  });

  it('searching only for the same question', () => {
    const thinking = run([{ type: 'thinking', id: 'a1', question: 'Q' }]);
    expect(answerReducer(thinking, { type: 'searching', id: 'other' })).toBe(thinking);
    expect(answerReducer(thinking, { type: 'searching', id: 'a1' })).toMatchObject({ phase: 'searching' });
  });

  it('ignores sentences from another question', () => {
    const s = run([
      { type: 'thinking', id: 'a2', question: 'New' },
      { type: 'delta', id: 'a1', text: 'old sentence' },
    ]);
    expect(s).toMatchObject({ phase: 'thinking', id: 'a2' });
  });

  it('shows a prepared answer that arrives without thinking', () => {
    const s = answerReducer(initialCardState, { type: 'answer', answer: answer({ origin: 'prepared', streamed: false }) });
    expect(s).toMatchObject({ phase: 'answer', answer: { origin: 'prepared' } });
  });

  it('ignores a late answer to an older question', () => {
    const old = answer({ id: 'a1', timestamp: Date.now() / 1000 - 10 });
    const s = run([
      { type: 'thinking', id: 'a2', question: 'New' },
      { type: 'answer', answer: old },
    ]);
    expect(s).toMatchObject({ phase: 'thinking', id: 'a2' });
  });

  it('an error answer goes to the error view', () => {
    const s = answerReducer(initialCardState, {
      type: 'answer',
      answer: answer({ origin: 'error', answer: 'Claude is busy.' }),
    });
    expect(s).toMatchObject({ phase: 'error', message: 'Claude is busy.', question: 'What is RLS?' });
  });

  it('hide goes back to waiting', () => {
    const s = run([{ type: 'thinking', id: 'a1', question: 'Q' }, { type: 'hide' }]);
    expect(s).toEqual({ phase: 'hidden' });
  });
});
