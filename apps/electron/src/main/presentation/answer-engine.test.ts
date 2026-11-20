import { describe, expect, it, vi } from 'vitest';
import type { Deck } from '../../shared/types';
import type { LLMResult, SearchResult } from '../llm/providers/llm-provider';
import { AnswerEngine, AnswerError, AnswerLLM } from './answer-engine';
import { parsePrediction, predictQuestions } from './qa-predictor';

const deck: Deck = {
  id: 'd1',
  name: 'Neural Nets.pptx',
  filePath: '/x/Neural Nets.pptx',
  loadedAt: 0,
  slides: [
    { number: 1, title: 'Neural Networks', body: 'Layers of neurons', notes: '' },
    { number: 2, title: 'Dropout', body: 'Randomly disable neurons in training', notes: 'Prevents overfitting' },
  ],
  predicted: [{ id: 'p1', slide: 2, question: 'Why does dropout prevent overfitting?', answer: 'PREPARED' }],
  prepStatus: 'ready',
};

const ok = (text: string): LLMResult => ({ ok: true, text });

function fakeLLM(opts: {
  native?: boolean;
  text?: (system: string, user: string) => LLMResult;
  search?: SearchResult;
}): AnswerLLM & { textComplete: ReturnType<typeof vi.fn>; webSearchComplete: ReturnType<typeof vi.fn> } {
  return {
    supportsNativeSearch: () => !!opts.native,
    textComplete: vi.fn(async (system: string, user: string) => opts.text?.(system, user) ?? ok('')),
    webSearchComplete: vi.fn(async () => opts.search ?? { ok: true, text: '', sources: [], searched: false }),
  };
}

const req = (question: string, d: Deck | null = deck) => ({ question, deck: d, currentSlide: 2, recent: [] });

describe('AnswerEngine', () => {
  it('answers a prepared question instantly, with no model call', async () => {
    const llm = fakeLLM({ native: true });
    const engine = new AnswerEngine(llm, () => null);
    const r = await engine.answer(req('why does dropout prevent overfitting'));
    expect(r).toEqual({ answer: 'PREPARED', origin: 'prepared', sources: [] });
    expect(llm.webSearchComplete).not.toHaveBeenCalled();
    expect(llm.textComplete).not.toHaveBeenCalled();
  });

  it('with Claude, labels an answer that needed no search as from the slides', async () => {
    const llm = fakeLLM({ native: true, search: { ok: true, text: 'Slides say so.', sources: [], searched: false } });
    const r = await new AnswerEngine(llm, () => null).answer(req('What do the layers do?'));
    expect(r.origin).toBe('slides');
    const [, message] = llm.webSearchComplete.mock.calls[0];
    expect(message).toContain('Slide 2: Dropout');
    expect(message).toContain('currently on slide 2');
    expect(message).toContain('Audience question: What do the layers do?');
  });

  it('with Claude, labels a searched answer as from the web and keeps sources', async () => {
    const sources = [1, 2, 3, 4].map((i) => ({ title: `T${i}`, url: `https://e.com/${i}` }));
    const llm = fakeLLM({ native: true, search: { ok: true, text: 'Found it.', sources, searched: true } });
    const r = await new AnswerEngine(llm, () => null).answer(req('Who invented dropout?'));
    expect(r.origin).toBe('web');
    expect(r.sources).toHaveLength(3);
  });

  it('without native search, answers from slides when the model says they cover it', async () => {
    const llm = fakeLLM({ text: () => ok('{"covered": true, "answer": "From slide 1."}') });
    const search = vi.fn();
    const r = await new AnswerEngine(llm, () => search).answer(req('What are layers?'));
    expect(r).toEqual({ answer: 'From slide 1.', origin: 'slides', sources: [] });
    expect(search).not.toHaveBeenCalled();
  });

  it('without native search, falls back to the search API when slides do not cover it', async () => {
    const llm = fakeLLM({
      text: (system) => (system.includes('"covered"') ? ok('{"covered": false, "answer": ""}') : ok('Web answer.')),
    });
    const search = vi.fn(async () => ({
      ok: true as const,
      results: [{ title: 'Paper', url: 'https://jmlr.org/dropout', content: 'Srivastava et al. 2014' }],
    }));
    const r = await new AnswerEngine(llm, () => search).answer(req('Who invented dropout?'));
    expect(r.origin).toBe('web');
    expect(r.sources).toEqual([{ title: 'Paper', url: 'https://jmlr.org/dropout' }]);
    expect(llm.textComplete.mock.calls[1][1]).toContain('Srivastava et al. 2014');
  });

  it('answers from general knowledge when there is no way to search', async () => {
    const llm = fakeLLM({
      text: (system) => (system.includes('"covered"') ? ok('{"covered": false}') : ok('General answer.')),
    });
    const r = await new AnswerEngine(llm, () => null).answer(req('What is a GPU?'));
    expect(r).toEqual({ answer: 'General answer.', origin: 'general', sources: [] });
  });

  it('turns a model error into an AnswerError carrying its kind', async () => {
    const llm = fakeLLM({
      native: true,
      search: { ok: false, error: { kind: 'missing_key', message: 'No API key' } },
    });
    await expect(new AnswerEngine(llm, () => null).answer(req('Anything?'))).rejects.toMatchObject({
      kind: 'missing_key',
    });
    await expect(new AnswerEngine(llm, () => null).answer(req('Anything?'))).rejects.toBeInstanceOf(AnswerError);
  });
});

describe('predictQuestions', () => {
  it('parses JSON wrapped in prose or fences and drops malformed items', () => {
    const text =
      'Here you go:\n```json\n{"questions":[{"slide":2,"question":"Q?","answer":"A."},{"slide":3,"question":""},{"question":"No slide?","answer":"Yes."}]}\n```';
    const parsed = parsePrediction(text);
    expect(parsed.map((q) => [q.slide, q.question])).toEqual([
      [2, 'Q?'],
      [0, 'No slide?'],
    ]);
  });

  it('batches slides, keeps successful batches, and drops questions about slides outside the batch', async () => {
    const slides = Array.from({ length: 8 }, (_, i) => ({ number: i + 1, title: `S${i + 1}`, body: '', notes: '' }));
    let call = 0;
    const llm = {
      textComplete: vi.fn(async () => {
        call++;
        if (call === 2) return { ok: false as const, error: { kind: 'network' as const, message: 'down' } };
        return ok('{"questions":[{"slide":1,"question":"Q1?","answer":"A1."},{"slide":99,"question":"Q?","answer":"A."}]}');
      }),
    };
    const progress = vi.fn();
    const out = await predictQuestions(llm, 'Deck', slides, progress);
    expect(llm.textComplete).toHaveBeenCalledTimes(2); // 8 slides → batches of 6 + 2
    expect(out.error).toBeUndefined();
    expect(out.questions.map((q) => q.question)).toEqual(['Q1?']);
    expect(progress).toHaveBeenLastCalledWith(2, 2);
  });

  it('reports an error when every batch fails', async () => {
    const llm = { textComplete: async () => ({ ok: false as const, error: { kind: 'missing_key' as const, message: 'No key' } }) };
    const out = await predictQuestions(llm, 'Deck', deck.slides);
    expect(out).toEqual({ questions: [], error: 'No key' });
  });
});
