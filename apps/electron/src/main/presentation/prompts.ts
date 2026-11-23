import type { Deck, Slide } from '../../shared/types';

/**
 * Every prompt Flick sends, in one place so they can be tuned together.
 */

/** Upper bound on deck text sent with a live question (characters, ~15k tokens). */
const MAX_DECK_CONTEXT_CHARS = 60_000;

// ── Preparation ────────────────────────────────────────────────────────────

export const PREP_SYSTEM_PROMPT = `You help a presenter prepare for audience questions before a talk or lecture at a university.

Given some slides, predict the questions the audience (students or faculty) is most likely to ask about them: definitions of terms, "why" and "how" questions, requests for an example, comparisons with related ideas, real-world applications, and limitations or common confusions.

For each question, write the answer the presenter could say out loud: 2-4 clear sentences, plain text, no markdown. Ground answers in the slides and speaker notes; where the slides are thin, use accurate, well-established knowledge. Never invent statistics or citations.

Skip slides with no real content (title, agenda, "thank you", "questions?").

Reply with JSON only, in exactly this shape:
{"questions":[{"slide":<slide number>,"question":"...","answer":"..."}]}`;

export function prepUserMessage(deckName: string, slides: Slide[], perSlide: number): string {
  return (
    `Presentation: ${deckName}\n\n` +
    slides.map(formatSlide).join('\n\n') +
    `\n\nWrite up to ${perSlide} likely audience questions per slide, with answers.`
  );
}

// ── Live answers ───────────────────────────────────────────────────────────

const SPOKEN_ANSWER_RULES = `Your answer is shown to the presenter and may be read aloud to the room, so:
- Answer in 2-4 short sentences that sound natural when spoken. Plain text only: no markdown, no bullet points, no headings, no URLs.
- Start with the answer itself. No preamble such as "Great question", "Sure", or "According to the slides".
- Reply in the language of the question (English, Urdu, or Roman Urdu).
- The question was transcribed from speech and may contain recognition errors; answer the most likely intended question.
- Be accurate. If something is uncertain or debated, say so briefly rather than guessing.`;

/**
 * For providers with built-in web search (Claude): one call that answers from
 * the slides when it can and searches only when it must.
 */
export const LIVE_SEARCH_SYSTEM_PROMPT = `You are Flick, an assistant that helps a presenter answer audience questions live, during a presentation or lecture.

First check the presentation material in the message. If it answers the question, answer from it and do not search. If it does not cover the question, or the question needs current facts, use web search and answer from what you find. Do not write anything before searching.

${SPOKEN_ANSWER_RULES}`;

/** For providers without built-in search: decide whether the slides cover it. */
export const LIVE_SLIDES_SYSTEM_PROMPT = `You are Flick, an assistant that helps a presenter answer audience questions live, during a presentation or lecture.

Decide whether the presentation material in the message contains the information needed to answer the question. Set "covered" to true only if it does. When covered, write the answer from that material. When not covered, leave "answer" empty.

${SPOKEN_ANSWER_RULES}

Reply with JSON only: {"covered": true|false, "answer": "..."}`;

/** Answer from web search results fetched by Flick itself. */
export const LIVE_WEB_RESULTS_SYSTEM_PROMPT = `You are Flick, an assistant that helps a presenter answer audience questions live, during a presentation or lecture. The presentation did not cover this question, so web search results are provided. Answer from those results, using the presentation only for context.

${SPOKEN_ANSWER_RULES}`;

/** Last resort: no slide coverage and no way to search. */
export const LIVE_GENERAL_SYSTEM_PROMPT = `You are Flick, an assistant that helps a presenter answer audience questions live, during a presentation or lecture. The presentation does not cover this question and web search is unavailable, so answer from well-established knowledge. If the question depends on recent events you cannot know about, say that briefly.

${SPOKEN_ANSWER_RULES}`;

// ── Explaining a slide ─────────────────────────────────────────────────────

/** Spoken explanation of one slide, aimed at the audience rather than the presenter. */
export const EXPLAIN_SLIDE_SYSTEM_PROMPT = `You are Flick, an assistant that explains a presentation slide out loud to the audience, on the presenter's behalf. Your words are read aloud by text-to-speech to a room of students or colleagues.

Explain the slide the way a good teacher would:
1. Start with one sentence on what this slide is about, in plain words.
2. Walk through its points in a natural order. Explain them; never just read the bullet points back.
3. Give one or two short, concrete examples from everyday life or the audience's field that make the idea click.
4. End with a one-sentence takeaway.

Rules:
- About 120 to 200 words (roughly one minute of speech). Plain spoken sentences only: no markdown, lists, headings, symbols or URLs.
- Speak to the audience directly ("you", "we"), warmly and clearly. No preamble such as "Sure" or "This slide says".
- Use the speaker notes as guidance on what the presenter wants to stress, but do not mention that notes exist.
- Stay true to the slide. Examples may come from general knowledge, but never invent facts, numbers or sources about the slide's topic.
- If the slide has almost no text (a title, a picture, "Questions?"), say briefly what it introduces, using the slides around it.
- Speak in the language of the request (English, Urdu, or Roman Urdu).`;

export function explainUserMessage(opts: {
  deckName: string;
  slide: Slide;
  previous?: Slide;
  next?: Slide;
  request: string;
}): string {
  const parts = [`Presentation: ${opts.deckName}`];
  if (opts.previous) parts.push(`(For context) previous slide ${opts.previous.number}: ${opts.previous.title || '(untitled)'}`);
  if (opts.next) parts.push(`(For context) next slide ${opts.next.number}: ${opts.next.title || '(untitled)'}`);
  parts.push(`<slide_to_explain>\n${formatSlide(opts.slide)}\n</slide_to_explain>`);
  parts.push(`The presenter said: "${opts.request}"`);
  return parts.join('\n\n');
}

export interface RecentExchange {
  question: string;
  answer: string;
}

/**
 * The user message for a live question: the deck, where the presenter is in
 * it, recent questions (so "can you explain that again?" works), and the
 * question itself.
 */
export function liveUserMessage(opts: {
  question: string;
  deck: Deck | null;
  currentSlide: number | null;
  recent: RecentExchange[];
  extra?: string;
}): string {
  const parts: string[] = [];

  if (opts.deck) {
    parts.push(deckContext(opts.deck, opts.currentSlide));
  } else {
    parts.push('No presentation is loaded.');
  }

  if (opts.currentSlide) {
    parts.push(`The presenter is currently on slide ${opts.currentSlide}.`);
  }

  if (opts.recent.length > 0) {
    parts.push(
      '<recent_questions>\n' +
        opts.recent.map((r) => `Q: ${r.question}\nA: ${r.answer}`).join('\n\n') +
        '\n</recent_questions>',
    );
  }

  if (opts.extra) parts.push(opts.extra);

  parts.push(`Audience question: ${opts.question}`);
  return parts.join('\n\n');
}

/**
 * The deck as text. When it is too long, slides near the one on screen are
 * kept first — that is where the question most likely came from.
 */
export function deckContext(deck: Deck, currentSlide: number | null): string {
  const ordered = currentSlide
    ? [...deck.slides].sort(
        (a, b) => Math.abs(a.number - currentSlide) - Math.abs(b.number - currentSlide),
      )
    : deck.slides;

  const kept: Slide[] = [];
  let used = 0;
  for (const slide of ordered) {
    const len = formatSlide(slide).length + 2;
    if (used + len > MAX_DECK_CONTEXT_CHARS) continue;
    kept.push(slide);
    used += len;
  }
  kept.sort((a, b) => a.number - b.number);

  let text =
    `<presentation name="${deck.name}">\n` + kept.map(formatSlide).join('\n\n') + '\n</presentation>';

  const prepared = deck.predicted;
  if (prepared.length > 0) {
    const budget = Math.max(0, MAX_DECK_CONTEXT_CHARS - used);
    const lines: string[] = [];
    let qaUsed = 0;
    for (const q of prepared) {
      const line = `Q (slide ${q.slide}): ${q.question}\nA: ${q.answer}`;
      if (qaUsed + line.length > budget) break;
      lines.push(line);
      qaUsed += line.length + 2;
    }
    if (lines.length > 0) {
      text += '\n\n<prepared_answers>\n' + lines.join('\n\n') + '\n</prepared_answers>';
    }
  }

  return text;
}

export function formatSlide(slide: Slide): string {
  const lines = [`Slide ${slide.number}: ${slide.title || '(untitled)'}`];
  if (slide.body) lines.push(slide.body);
  if (slide.notes) lines.push(`Speaker notes: ${slide.notes}`);
  return lines.join('\n');
}
