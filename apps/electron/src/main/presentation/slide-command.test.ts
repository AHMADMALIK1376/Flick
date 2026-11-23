import { describe, expect, it } from 'vitest';
import { parseSlideCommand } from './slide-command';

describe('parseSlideCommand', () => {
  it('recognises "explain this slide" in its common forms', () => {
    for (const text of [
      'Explain this slide',
      'explain this slide to the audience',
      'Can you explain the current slide please?',
      'walk us through this slide',
      'describe the slide with an example',
      'go over this slide in simple words',
    ]) {
      expect(parseSlideCommand(text), text).toEqual({ kind: 'current' });
    }
  });

  it('reads a slide number given as digits or words', () => {
    expect(parseSlideCommand('explain slide 5')).toEqual({ kind: 'number', number: 5 });
    expect(parseSlideCommand('explain slide number 12 to everyone')).toEqual({ kind: 'number', number: 12 });
    expect(parseSlideCommand('explain the 3rd slide')).toEqual({ kind: 'number', number: 3 });
    expect(parseSlideCommand('explain slide five')).toEqual({ kind: 'number', number: 5 });
    expect(parseSlideCommand('explain the second slide')).toEqual({ kind: 'number', number: 2 });
  });

  it('understands next and previous', () => {
    expect(parseSlideCommand('explain the next slide')).toEqual({ kind: 'relative', offset: 1 });
    expect(parseSlideCommand('walk them through the previous slide')).toEqual({ kind: 'relative', offset: -1 });
  });

  it('understands Roman Urdu and Urdu', () => {
    expect(parseSlideCommand('is slide ko samjhao')).toEqual({ kind: 'current' });
    expect(parseSlideCommand('yeh slide samjha do')).toEqual({ kind: 'current' });
    expect(parseSlideCommand('slide 3 ko samjhao')).toEqual({ kind: 'number', number: 3 });
    expect(parseSlideCommand('agli slide samjhao')).toEqual({ kind: 'relative', offset: 1 });
    expect(parseSlideCommand('اس سلائیڈ کو سمجھاؤ')).toEqual({ kind: 'current' });
  });

  it('leaves real questions to the answer cascade', () => {
    for (const text of [
      'What is gradient descent?',
      'Why does slide 3 say the loss is convex?',
      'Can you explain why the learning rate matters?',
      'how many slides are there',
      'Can you explain what happens on slide 4 when the learning rate is too large and the loss starts to bounce around?',
    ]) {
      expect(parseSlideCommand(text), text).toBeNull();
    }
  });
});
