import { describe, expect, it } from 'vitest';
import { tokens, usd } from './format';

describe('usage format', () => {
  it('shows small costs with enough decimals', () => {
    expect(usd(0)).toBe('$0.00');
    expect(usd(0.00123)).toBe('$0.0012');
    expect(usd(0.0456)).toBe('$0.046');
    expect(usd(2.5)).toBe('$2.50');
  });
  it('shortens token counts', () => {
    expect(tokens(950)).toBe('950');
    expect(tokens(4321)).toBe('4.3K');
    expect(tokens(48_000)).toBe('48K');
    expect(tokens(2_500_000)).toBe('2.50M');
  });
});
