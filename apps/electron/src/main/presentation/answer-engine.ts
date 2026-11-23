import type { AnswerOrigin, Deck, Slide, WebSourceRef } from '../../shared/types';
import type { LLMResult, SearchResult } from '../llm/providers/llm-provider';
import { findBestMatch } from './question-matcher';
import {
  EXPLAIN_SLIDE_SYSTEM_PROMPT,
  LIVE_GENERAL_SYSTEM_PROMPT,
  LIVE_SEARCH_SYSTEM_PROMPT,
  LIVE_SLIDES_SYSTEM_PROMPT,
  LIVE_WEB_RESULTS_SYSTEM_PROMPT,
  RecentExchange,
  explainUserMessage,
  liveUserMessage,
} from './prompts';
import { SearchOutcome, formatResults } from './web-search';

/** The slice of LLMService the engine needs — injectable for tests. */
export interface AnswerLLM {
  textComplete(
    systemPrompt: string,
    userMessage: string,
    jsonMode: boolean,
    maxTokens?: number,
  ): Promise<LLMResult>;
  supportsNativeSearch(): boolean;
  webSearchComplete(
    systemPrompt: string,
    userMessage: string,
    maxTokens?: number,
    maxSearches?: number,
  ): Promise<SearchResult>;
}

/** Searches the web without the model's help; null when no search key is set. */
export type WebSearchFn = ((query: string) => Promise<SearchOutcome>) | null;

export interface AnswerRequest {
  question: string;
  deck: Deck | null;
  currentSlide: number | null;
  recent: RecentExchange[];
}

export interface EngineAnswer {
  answer: string;
  origin: AnswerOrigin;
  sources: WebSourceRef[];
}

/** Room for a short spoken answer, plus slack for citation markup. */
const ANSWER_MAX_TOKENS = 700;
const MAX_SEARCHES = 3;
const SOURCES_SHOWN = 3;
/** A minute of speech is ~200 words; this leaves room without letting it run on. */
const EXPLAIN_MAX_TOKENS = 900;

/**
 * Answers one live question by working down a cascade, fastest first:
 *
 *  1. Prepared — the question matches one predicted before the talk.
 *     Answered instantly, with no model call.
 *  2. Slides — the deck (and the prepared answers) cover it.
 *  3. Web — the deck does not cover it, so search the web and answer from that.
 *  4. General — no deck coverage and no way to search: answer from the
 *     model's own knowledge, labelled as such.
 *
 * With Claude, steps 2 and 3 are a single request: Claude is given the slides
 * and its built-in web search, and searches only when the slides fall short.
 */
export class AnswerEngine {
  constructor(
    private readonly llm: AnswerLLM,
    private readonly webSearch: () => WebSearchFn,
  ) {}

  async answer(req: AnswerRequest): Promise<EngineAnswer> {
    // 1. Prepared answer.
    if (req.deck && req.deck.predicted.length > 0) {
      const match = findBestMatch(req.question, req.deck.predicted);
      if (match) {
        return { answer: match.item.answer, origin: 'prepared', sources: [] };
      }
    }

    const message = liveUserMessage(req);

    // 2 + 3 in one call, when the provider can search for itself.
    if (this.llm.supportsNativeSearch()) {
      const result = await this.llm.webSearchComplete(
        LIVE_SEARCH_SYSTEM_PROMPT,
        message,
        ANSWER_MAX_TOKENS,
        MAX_SEARCHES,
      );
      if (!result.ok) throw new AnswerError(result.error.message, result.error.kind);
      return {
        answer: result.text,
        origin: result.searched ? 'web' : req.deck ? 'slides' : 'general',
        sources: result.sources.slice(0, SOURCES_SHOWN),
      };
    }

    // 2. Slides, judged by the model.
    if (req.deck) {
      const result = await this.llm.textComplete(LIVE_SLIDES_SYSTEM_PROMPT, message, true, ANSWER_MAX_TOKENS);
      if (!result.ok) throw new AnswerError(result.error.message, result.error.kind);
      const judged = parseCovered(result.text);
      if (judged.covered && judged.answer) {
        return { answer: judged.answer, origin: 'slides', sources: [] };
      }
    }

    // 3. Web, through the separate search API.
    const search = this.webSearch();
    if (search) {
      const found = await search(req.question);
      if (found.ok && found.results.length > 0) {
        const withResults = liveUserMessage({ ...req, extra: formatResults(found.results) });
        const result = await this.llm.textComplete(
          LIVE_WEB_RESULTS_SYSTEM_PROMPT,
          withResults,
          false,
          ANSWER_MAX_TOKENS,
        );
        if (!result.ok) throw new AnswerError(result.error.message, result.error.kind);
        return {
          answer: result.text.trim(),
          origin: 'web',
          sources: found.results.slice(0, SOURCES_SHOWN).map(({ title, url }) => ({ title, url })),
        };
      }
      // A failed search falls through to a general answer rather than nothing.
    }

    // 4. General knowledge.
    const result = await this.llm.textComplete(LIVE_GENERAL_SYSTEM_PROMPT, message, false, ANSWER_MAX_TOKENS);
    if (!result.ok) throw new AnswerError(result.error.message, result.error.kind);
    return { answer: result.text.trim(), origin: 'general', sources: [] };
  }
}

export interface ExplainRequest {
  deck: Deck;
  slideNumber: number;
  /** What the presenter said, so the explanation follows its language and any focus asked for. */
  request: string;
}

/**
 * Explains one slide to the audience, with examples. Uses the slide and its
 * neighbours only: no web search, because the explanation must stay true to
 * what the presenter is showing.
 */
export async function explainSlide(llm: AnswerLLM, req: ExplainRequest): Promise<string> {
  const at = (n: number): Slide | undefined => req.deck.slides.find((s) => s.number === n);
  const slide = at(req.slideNumber);
  if (!slide) throw new AnswerError(`This presentation has ${req.deck.slides.length} slides.`, 'no_slide');

  const result = await llm.textComplete(
    EXPLAIN_SLIDE_SYSTEM_PROMPT,
    explainUserMessage({
      deckName: req.deck.name,
      slide,
      previous: at(req.slideNumber - 1),
      next: at(req.slideNumber + 1),
      request: req.request,
    }),
    false,
    EXPLAIN_MAX_TOKENS,
  );
  if (!result.ok) throw new AnswerError(result.error.message, result.error.kind);
  return result.text.trim();
}

export class AnswerError extends Error {
  constructor(
    message: string,
    readonly kind: string,
  ) {
    super(message);
  }
}

export function parseCovered(text: string): { covered: boolean; answer: string } {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return { covered: false, answer: '' };
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as { covered?: unknown; answer?: unknown };
    return {
      covered: parsed.covered === true,
      answer: typeof parsed.answer === 'string' ? parsed.answer.trim() : '',
    };
  } catch {
    return { covered: false, answer: '' };
  }
}
