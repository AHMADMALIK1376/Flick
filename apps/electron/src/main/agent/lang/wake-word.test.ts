import { describe, it, expect } from 'vitest';
import { stripWakeWord } from './wake-word';

const s = (text: string) => stripWakeWord(text.split(' ')).join(' ');

describe('stripWakeWord', () => {
  it('strips the name at the start', () => {
    expect(s('flick open notepad')).toBe('open notepad');
  });

  it('strips the common mis-transcription "flix"', () => {
    expect(s('flix open the notepad')).toBe('open the notepad');
  });

  it('strips "flik"', () => {
    expect(s('flik open notepad')).toBe('open notepad');
  });

  it('strips a filler before the name', () => {
    expect(s('hey flick open notepad')).toBe('open notepad');
  });

  it('strips fillers after the name', () => {
    expect(s('flick please open notepad')).toBe('open notepad');
  });

  it('handles the long-winded case that broke the lookahead window', () => {
    expect(s('flick can you please open notepad')).toBe('open notepad');
  });

  it('strips politeness only after the name, never from bare prose', () => {
    expect(s('can you open the discussion')).toBe('can you open the discussion');
  });

  it('leaves an utterance without the name untouched', () => {
    expect(s('hello friends open a notepad')).toBe('hello friends open a notepad');
  });

  it('does not strip the name when it appears as content', () => {
    expect(s('type flick into the box')).toBe('type flick into the box');
  });

  it('does not strip when real words precede the name', () => {
    expect(s('the movie flick was good')).toBe('the movie flick was good');
  });

  it('keeps the original when the name is the only word', () => {
    expect(s('flick')).toBe('flick');
  });

  it('keeps the original for an address with no command', () => {
    expect(s('hey flick')).toBe('hey flick');
  });

  it('leaves an empty token list alone', () => {
    expect(stripWakeWord([])).toEqual([]);
  });
});
