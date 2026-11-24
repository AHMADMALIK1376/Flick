import { describe, expect, it } from 'vitest';
import type { Answer } from '../../api/types';
import { ONE_MOMENT, speechFor } from './speech';

const answer = (over: Partial<Answer> = {}): Answer => ({
  id: 'a',
  question: 'Q',
  answer: 'The answer.',
  origin: 'prepared',
  sources: [],
  current_slide: null,
  duration_ms: 20,
  timestamp: 0,
  speak: true,
  streamed: false,
  voiced: false,
  ...over,
});

describe('speechFor', () => {
  it('a new question stops speech', () => {
    expect(speechFor({ type: 'thinking', data: { id: 'a', question: 'Q' } })).toEqual({ cancel: true });
  });
  it('says "one moment" while searching', () => {
    expect(speechFor({ type: 'searching', data: { id: 'a', speak: true } })).toEqual({ say: ONE_MOMENT });
    expect(speechFor({ type: 'searching', data: { id: 'a', speak: false } })).toBeNull();
  });
  it('says streamed sentences', () => {
    expect(speechFor({ type: 'answer_delta', data: { id: 'a', text: 'Hello.', speak: true } })).toEqual({ say: 'Hello.' });
  });
  it('says a prepared answer once, at the end', () => {
    expect(speechFor({ type: 'answer', data: answer() })).toEqual({ say: 'The answer.' });
  });
  it('does not repeat a streamed answer', () => {
    expect(speechFor({ type: 'answer', data: answer({ streamed: true }) })).toBeNull();
  });
  it('stays quiet when Flick already said it', () => {
    expect(speechFor({ type: 'answer', data: answer({ voiced: true }) })).toBeNull();
    expect(speechFor({ type: 'answer_delta', data: { id: 'a', text: 'Hi.', speak: true, voiced: true } })).toBeNull();
    expect(speechFor({ type: 'searching', data: { id: 'a', speak: true, voiced: true } })).toBeNull();
  });
  it('never speaks errors or private answers', () => {
    expect(speechFor({ type: 'answer', data: answer({ origin: 'error' }) })).toBeNull();
    expect(speechFor({ type: 'answer', data: answer({ speak: false }) })).toBeNull();
  });
});
