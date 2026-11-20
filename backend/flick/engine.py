"""The answer cascade, slide explanations, and question prediction."""

from __future__ import annotations

import asyncio
import json
import uuid
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional, Sequence

from . import prompts
from .llm import LLM, LLMError
from .matcher import find_best_match
from .models import Deck, PredictedQuestion, Slide, WebSource

ANSWER_MAX_TOKENS = 700
MAX_SEARCHES = 3
SOURCES_SHOWN = 3
#: About a minute of speech is ~200 words; this leaves room without running on.
EXPLAIN_MAX_TOKENS = 900

SLIDES_PER_BATCH = 6
QUESTIONS_PER_SLIDE = 3
PREP_MAX_TOKENS = 3500
PREP_CONCURRENCY = 2


@dataclass
class EngineAnswer:
    answer: str
    origin: str
    sources: list[WebSource] = field(default_factory=list)


async def answer_question(
    llm: LLM,
    question: str,
    deck: Optional[Deck],
    current_slide: Optional[int],
    recent: Sequence[tuple[str, str]],
) -> EngineAnswer:
    """
    Fastest source first:
      1. Prepared: matches a question predicted before the talk. Instant, no AI call.
      2. Slides, or 3. web: one Claude request with the deck and web search;
         Claude searches only when the slides fall short.
    """
    if deck and deck.predicted:
        match = find_best_match(question, deck.predicted)
        if match:
            return EngineAnswer(match.item.answer, "prepared")

    result = await llm.search_complete(
        prompts.LIVE_SYSTEM,
        prompts.live_message(question, deck, current_slide, recent),
        ANSWER_MAX_TOKENS,
        MAX_SEARCHES,
    )
    origin = "web" if result.searched else ("slides" if deck else "general")
    return EngineAnswer(result.text, origin, result.sources[:SOURCES_SHOWN])


async def explain_slide(llm: LLM, deck: Deck, number: int, request: str) -> str:
    """A ~1 minute explanation for the audience, from the slide and its neighbours. No web search."""
    by_number = {s.number: s for s in deck.slides}
    slide = by_number.get(number)
    if slide is None:
        raise LLMError("no_slide", f"This presentation has {len(deck.slides)} slides.")
    return await llm.complete(
        prompts.EXPLAIN_SYSTEM,
        prompts.explain_message(deck.name, slide, by_number.get(number - 1), by_number.get(number + 1), request),
        EXPLAIN_MAX_TOKENS,
    )


@dataclass
class PrepOutcome:
    questions: list[PredictedQuestion]
    error: Optional[LLMError] = None  # set only when every batch failed


async def predict_questions(
    llm: LLM,
    deck_name: str,
    slides: Sequence[Slide],
    on_progress: Optional[Callable[[int, int], Awaitable[None]]] = None,
) -> PrepOutcome:
    """Predicts likely audience questions in batches, keeping whatever succeeds."""
    batches = [list(slides[i : i + SLIDES_PER_BATCH]) for i in range(0, len(slides), SLIDES_PER_BATCH)]
    results: list[list[PredictedQuestion]] = [[] for _ in batches]
    errors: list[LLMError] = []
    done = 0
    gate = asyncio.Semaphore(PREP_CONCURRENCY)
    if on_progress:
        await on_progress(0, len(batches))

    async def run(index: int, batch: list[Slide]) -> None:
        nonlocal done
        async with gate:
            try:
                text = await llm.complete(
                    prompts.PREP_SYSTEM, prompts.prep_message(deck_name, batch, QUESTIONS_PER_SLIDE), PREP_MAX_TOKENS
                )
                valid = {s.number for s in batch}
                results[index] = [q for q in parse_prediction(text) if q.slide in valid or q.slide == 0]
            except LLMError as err:
                errors.append(err)
            done += 1
            if on_progress:
                await on_progress(done, len(batches))

    await asyncio.gather(*(run(i, b) for i, b in enumerate(batches)))
    questions = [q for batch in results for q in batch]
    if not questions and errors:
        return PrepOutcome([], errors[0])
    return PrepOutcome(questions)


def parse_prediction(text: str) -> list[PredictedQuestion]:
    """Reads the model's JSON, tolerating stray prose or code fences around it."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return []
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return []
    items = data.get("questions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        return []
    out = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        q, a = str(raw.get("question") or "").strip(), str(raw.get("answer") or "").strip()
        if not q or not a:
            continue
        try:
            slide = int(raw.get("slide", 0))
        except (TypeError, ValueError):
            slide = 0
        out.append(PredictedQuestion(id=str(uuid.uuid4()), slide=max(slide, 0), question=q, answer=a))
    return out
