import { describe, expect, it } from 'vitest';
import { styleLabel } from './BoardPicker';

const names = { story: 'Story mode', class: 'Standard', visual: 'Visual mode' };

describe('styleLabel', () => {
  it('names the mode and the whiteboard option', () => {
    expect(styleLabel('story', names)).toBe('Story mode');
    expect(styleLabel('story+example', names)).toBe('Story mode · Example every slide');
    expect(styleLabel('class+draw', names)).toBe('Standard · Draw every slide');
    expect(styleLabel('visual', names)).toBe('Visual mode');
  });
});
