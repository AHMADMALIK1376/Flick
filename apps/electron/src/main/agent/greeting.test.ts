import { describe, it, expect } from 'vitest';
import {
  isBareAddress,
  salutation,
  ordinal,
  buildGreeting,
} from './greeting';

describe('isBareAddress', () => {
  it('recognises the bare name', () => {
    expect(isBareAddress('Flick')).toBe(true);
    expect(isBareAddress('flick')).toBe(true);
  });

  it('recognises Whisper mis-hearings of the name', () => {
    expect(isBareAddress('Flix')).toBe(true);
    expect(isBareAddress('Flik')).toBe(true);
  });

  it('recognises a greeting prefix', () => {
    expect(isBareAddress('Hey Flick')).toBe(true);
    expect(isBareAddress('ok flick')).toBe(true);
  });

  it('ignores punctuation and casing', () => {
    expect(isBareAddress('Flick?')).toBe(true);
    expect(isBareAddress('  Flick.  ')).toBe(true);
  });

  it('is false when a real command follows the name', () => {
    expect(isBareAddress('flick open notepad')).toBe(false);
    expect(isBareAddress('flick what is the weather')).toBe(false);
  });

  it('is false for unrelated speech', () => {
    expect(isBareAddress('open notepad')).toBe(false);
    expect(isBareAddress('')).toBe(false);
  });
});

describe('salutation', () => {
  it('greets by time of day', () => {
    expect(salutation(6)).toBe('Good morning');
    expect(salutation(11)).toBe('Good morning');
    expect(salutation(12)).toBe('Good afternoon');
    expect(salutation(16)).toBe('Good afternoon');
    expect(salutation(17)).toBe('Good evening');
    expect(salutation(23)).toBe('Good evening');
  });
});

describe('ordinal', () => {
  it('handles the common cases', () => {
    expect(ordinal(1)).toBe('st');
    expect(ordinal(2)).toBe('nd');
    expect(ordinal(3)).toBe('rd');
    expect(ordinal(4)).toBe('th');
    expect(ordinal(21)).toBe('st');
    expect(ordinal(22)).toBe('nd');
  });

  it('handles the 11-13 exception', () => {
    expect(ordinal(11)).toBe('th');
    expect(ordinal(12)).toBe('th');
    expect(ordinal(13)).toBe('th');
  });
});

describe('buildGreeting', () => {
  it('produces a natural evening greeting', () => {
    // Tuesday, 21 July 2026, 21:40 local.
    const g = buildGreeting(new Date(2026, 6, 21, 21, 40));
    expect(g).toBe(
      "Good evening, boss. It's 9:40 PM, Tuesday the 21st. What can I do for you?",
    );
  });

  it('formats midnight and noon correctly', () => {
    expect(buildGreeting(new Date(2026, 6, 21, 0, 5))).toContain('12:05 AM');
    expect(buildGreeting(new Date(2026, 6, 21, 12, 0))).toContain('12:00 PM');
  });

  it('zero-pads the minutes', () => {
    expect(buildGreeting(new Date(2026, 6, 21, 9, 4))).toContain('9:04 AM');
  });
});
