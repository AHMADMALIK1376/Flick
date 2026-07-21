import { describe, it, expect } from 'vitest';
import { detectLanguage, hasUrduScript } from './detect-language';

describe('hasUrduScript', () => {
  it('detects Urdu script', () => {
    expect(hasUrduScript('کھولو')).toBe(true);
  });

  it('returns false for pure Latin', () => {
    expect(hasUrduScript('open chrome')).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('detects plain English', () => {
    expect(detectLanguage('open chrome')).toBe('en');
  });

  it('detects pure Urdu script', () => {
    expect(detectLanguage('کروم کھولو')).toBe('ur');
  });

  it('detects Urdu script mixed with Latin', () => {
    expect(detectLanguage('chrome کھولو')).toBe('mixed');
  });

  it('detects Roman Urdu by marker word', () => {
    expect(detectLanguage('chrome open karo')).toBe('roman-ur');
  });

  it('detects Roman Urdu from possessives', () => {
    expect(detectLanguage('mera assignment kholo')).toBe('roman-ur');
  });

  it('does not misread English containing "do" as Roman Urdu', () => {
    expect(detectLanguage('do the search')).toBe('en');
  });

  it('does not misread English containing "main" as Roman Urdu', () => {
    expect(detectLanguage('open the main folder')).toBe('en');
  });

  it('treats empty input as English', () => {
    expect(detectLanguage('')).toBe('en');
  });
});
