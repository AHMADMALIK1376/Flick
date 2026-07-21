import { describe, it, expect } from 'vitest';
import { normalize, collapseRepeats } from './normalize';

describe('normalize', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalize('  Chrome   OPEN   Karo  ')).toBe('chrome open karo');
  });

  it('strips punctuation', () => {
    expect(normalize('Chrome open karo!!!')).toBe('chrome open karo');
  });

  it('preserves Urdu script', () => {
    expect(normalize('کروم کھولو')).toBe('کروم کھولو');
  });

  it('strips Urdu diacritics', () => {
    expect(normalize('کَھولو')).toBe('کھولو');
  });

  it('returns empty string for whitespace-only input', () => {
    expect(normalize('   ')).toBe('');
  });
});

describe('collapseRepeats', () => {
  it('collapses doubled letters to one', () => {
    expect(collapseRepeats('khollo')).toBe('kholo');
  });

  it('leaves single letters untouched', () => {
    expect(collapseRepeats('kholo')).toBe('kholo');
  });

  it('collapses long runs', () => {
    expect(collapseRepeats('kaaaro')).toBe('karo');
  });
});
