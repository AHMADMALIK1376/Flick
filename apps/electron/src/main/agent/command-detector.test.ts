import { describe, it, expect } from 'vitest';
import { CommandDetector } from './command-detector';

const detector = new CommandDetector();

describe('CommandDetector — English (verb-initial)', () => {
  it('detects "open chrome"', () => {
    const result = detector.detect('open chrome');
    expect(result.isCommand).toBe(true);
    expect(result.language).toBe('en');
  });

  it('detects "take a screenshot"', () => {
    expect(detector.detect('take a screenshot').isCommand).toBe(true);
  });

  it('treats plain prose as dictation', () => {
    expect(detector.detect('the meeting went well today').isCommand).toBe(false);
  });

  it('detects a verb after a leading prepositional phrase', () => {
    expect(detector.detect('in chrome open youtube').isCommand).toBe(true);
  });

  it('detects a verb after a leading politeness phrase', () => {
    expect(detector.detect('can you open chrome').isCommand).toBe(true);
  });

  it('does not scan arbitrarily deep for a verb', () => {
    expect(
      detector.detect('i was thinking we should probably open that later').isCommand
    ).toBe(false);
  });
});

describe('CommandDetector — Roman Urdu (verb-final)', () => {
  it('detects "chrome open karo"', () => {
    const result = detector.detect('chrome open karo');
    expect(result.isCommand).toBe(true);
    expect(result.language).toBe('roman-ur');
  });

  it('detects "mera assignment kholo"', () => {
    expect(detector.detect('mera assignment kholo').isCommand).toBe(true);
  });

  it('detects the flagship demo phrase', () => {
    expect(detector.detect('mera assignment kholo aur samjhao').isCommand).toBe(true);
  });

  it('detects vowel-dropped spelling "chrome kro"', () => {
    expect(detector.detect('chrome kro').isCommand).toBe(true);
  });

  it('detects doubled-letter spelling "chrome khollo"', () => {
    expect(detector.detect('chrome khollo').isCommand).toBe(true);
  });

  it('detects a two-token verb "chrome khol do"', () => {
    expect(detector.detect('chrome khol do').isCommand).toBe(true);
  });

  it('does not match "sunday" as the verb stem "sun"', () => {
    expect(detector.detect('meeting sunday').isCommand).toBe(false);
  });
});

describe('CommandDetector — Urdu script (verb-final)', () => {
  it('detects "کروم کھولو"', () => {
    const result = detector.detect('کروم کھولو');
    expect(result.isCommand).toBe(true);
    expect(result.language).toBe('ur');
  });

  it('detects "مجھے موسم بتاؤ"', () => {
    expect(detector.detect('مجھے موسم بتاؤ').isCommand).toBe(true);
  });
});

describe('CommandDetector — edge cases', () => {
  it('returns isCommand false for empty input', () => {
    const result = detector.detect('');
    expect(result.isCommand).toBe(false);
    expect(result.confidence).toBe(0);
  });

  it('returns isCommand false for whitespace only', () => {
    expect(detector.detect('    ').isCommand).toBe(false);
  });

  it('gives short commands higher confidence than long ones', () => {
    const short = detector.detect('chrome kholo');
    const long = detector.detect('please can you now go ahead and open chrome for me');
    expect(short.confidence).toBeGreaterThan(long.confidence);
  });
});
