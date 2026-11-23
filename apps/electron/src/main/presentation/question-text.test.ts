import { describe, expect, it } from 'vitest';
import { cleanQuestion, isBareAddress, isNothingHeard } from './question-text';
import { findBestMatch, similarity } from './question-matcher';
import type { PredictedQuestion } from '../../shared/types';

describe('cleanQuestion', () => {
  it('drops the address to Flick', () => {
    expect(cleanQuestion('Flick, what is backpropagation?')).toBe('What is backpropagation?');
    expect(cleanQuestion('hey flix what is a GPU')).toBe('What is a GPU');
    expect(cleanQuestion('Okay Flik: why use ReLU?')).toBe('Why use ReLU?');
  });

  it('keeps "can you" — it belongs to the question', () => {
    expect(cleanQuestion('Flick, can neural networks overfit?')).toBe('Can neural networks overfit?');
  });

  it('leaves the name alone when it is part of the question', () => {
    expect(cleanQuestion('what does the flick gesture do')).toBe('What does the flick gesture do');
  });
});

describe('isBareAddress', () => {
  it('detects the name on its own', () => {
    expect(isBareAddress('Flick.')).toBe(true);
    expect(isBareAddress('hey flick')).toBe(true);
    expect(isBareAddress('Flick, what is AI?')).toBe(false);
  });
});

describe('isNothingHeard', () => {
  it('treats Whisper silence artefacts as nothing', () => {
    expect(isNothingHeard('')).toBe(true);
    expect(isNothingHeard(' Thank you. ')).toBe(true);
    expect(isNothingHeard('[BLANK_AUDIO]')).toBe(true);
    expect(isNothingHeard('Thank you for the talk, what is RNN?')).toBe(false);
  });
});

const prepared = (question: string, answer = 'A'): PredictedQuestion => ({
  id: question,
  slide: 1,
  question,
  answer,
});

describe('question matching', () => {
  it('matches the same question phrased slightly differently', () => {
    expect(similarity('What is backpropagation?', 'what is back propagation')).toBeLessThan(0.72);
    expect(
      similarity('What are the main limitations of neural networks?', 'what are limitations of neural networks'),
    ).toBeGreaterThanOrEqual(0.72);
  });

  it('does not confuse "what" with "why" questions about the same topic', () => {
    expect(similarity('What is dropout?', 'Why do we use dropout?')).toBeLessThan(0.72);
  });

  it('ignores a single shared word between longer questions', () => {
    expect(similarity('How does gradient descent find the minimum?', 'What is the minimum dataset size needed?')).toBe(0);
  });

  it('returns the best match above the threshold, or null', () => {
    const items = [prepared('What is overfitting?', 'over'), prepared('How do CNNs process images?', 'cnn')];
    expect(findBestMatch('how do CNNs process an image', items)?.item.answer).toBe('cnn');
    expect(findBestMatch('who invented the transistor', items)).toBeNull();
  });
});
