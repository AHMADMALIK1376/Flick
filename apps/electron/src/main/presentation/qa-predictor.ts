import { v4 as uuidv4 } from 'uuid';
import type { PredictedQuestion, Slide } from '../../shared/types';
import type { LLMResult } from '../llm/providers/llm-provider';
import { PREP_SYSTEM_PROMPT, prepUserMessage } from './prompts';

/** The slice of LLMService the predictor needs — injectable for tests. */
export interface PrepLLM {
  textComplete(
    systemPrompt: string,
    userMessage: string,
    jsonMode: boolean,
    maxTokens?: number,
  ): Promise<LLMResult>;
}

/** Slides per request: small enough that the JSON reply stays well-formed. */
const SLIDES_PER_BATCH = 6;
const QUESTIONS_PER_SLIDE = 3;
const MAX_TOKENS_PER_BATCH = 3500;
/** Batches in flight at once — faster prep without tripping rate limits. */
const CONCURRENCY = 2;

export interface PrepOutcome {
  questions: PredictedQuestion[];
  /** Set when every batch failed; partial failures still return questions. */
  error?: string;
}

/**
 * Predicts the audience's likely questions for a deck, with answers, before
 * the talk. Runs the deck in batches and keeps whatever succeeds, so one bad
 * batch does not cost the whole deck.
 */
export async function predictQuestions(
  llm: PrepLLM,
  deckName: string,
  slides: Slide[],
  onProgress?: (done: number, total: number) => void,
): Promise<PrepOutcome> {
  const batches: Slide[][] = [];
  for (let i = 0; i < slides.length; i += SLIDES_PER_BATCH) {
    batches.push(slides.slice(i, i + SLIDES_PER_BATCH));
  }

  const results: PredictedQuestion[][] = new Array(batches.length);
  const errors: string[] = [];
  let done = 0;
  let next = 0;
  onProgress?.(0, batches.length);

  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      const batch = batches[index];
      const result = await llm.textComplete(
        PREP_SYSTEM_PROMPT,
        prepUserMessage(deckName, batch, QUESTIONS_PER_SLIDE),
        true,
        MAX_TOKENS_PER_BATCH,
      );
      if (result.ok) {
        const valid = new Set(batch.map((s) => s.number));
        results[index] = parsePrediction(result.text).filter((q) => valid.has(q.slide) || q.slide === 0);
      } else {
        results[index] = [];
        errors.push(result.error.message);
      }
      done++;
      onProgress?.(done, batches.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));

  const questions = results.flat();
  if (questions.length === 0 && errors.length > 0) {
    return { questions, error: errors[0] };
  }
  return { questions };
}

/** Reads the model's JSON, tolerating stray prose or code fences around it. */
export function parsePrediction(text: string): PredictedQuestion[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const list = (parsed as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return [];

  const out: PredictedQuestion[] = [];
  for (const raw of list) {
    const q = raw as { slide?: unknown; question?: unknown; answer?: unknown };
    const question = typeof q.question === 'string' ? q.question.trim() : '';
    const answer = typeof q.answer === 'string' ? q.answer.trim() : '';
    if (!question || !answer) continue;
    const slide = Number(q.slide);
    out.push({
      id: uuidv4(),
      slide: Number.isInteger(slide) && slide >= 0 ? slide : 0,
      question,
      answer,
    });
  }
  return out;
}
