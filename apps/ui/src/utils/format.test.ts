import { describe, expect, it } from 'vitest';
import { formatDuration } from './format';

describe('formatDuration', () => {
  it('shows ms under one second', () => expect(formatDuration(340)).toBe('340 ms'));
  it('shows seconds from one second', () => expect(formatDuration(1234)).toBe('1.2 s'));
});
