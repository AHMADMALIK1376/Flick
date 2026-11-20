"""Every prompt Flick sends, in one place so they can be tuned together."""

from __future__ import annotations

from typing import Optional, Sequence

from .models import Deck, Slide

#: Upper bound on deck text sent with a live question (~15k tokens).
MAX_DECK_CONTEXT_CHARS = 60_000

# ── Preparing questions ─────────────────────────────────────────────────────

PREP_SYSTEM = """You help a presenter prepare for audience questions before a talk or lecture at a university.

Given some slides, predict the questions the audience (students or faculty) is most likely to ask about them: definitions of terms, "why" and "how" questions, requests for an example, comparisons with related ideas, real-world applications, and limitations or common confusions.

For each question, write the answer the presenter could say out loud: 2-4 clear sentences, plain text, no markdown. Ground answers in the slides and speaker notes; where the slides are thin, use accurate, well-established knowledge. Never invent statistics or citations.

Skip slides with no real content (title, agenda, "thank you", "questions?").

Reply with JSON only, in exactly this shape:
{"questions":[{"slide":<slide number>,"question":"...","answer":"..."}]}"""


def prep_message(deck_name: str, slides: Sequence[Slide], per_slide: int) -> str:
    return (
        f"Presentation: {deck_name}\n\n"
        + "\n\n".join(format_slide(s) for s in slides)
        + f"\n\nWrite up to {per_slide} likely audience questions per slide, with answers."
    )


# ── Live answers ────────────────────────────────────────────────────────────

SPOKEN_RULES = """Your answer is shown to the presenter and may be read aloud to the room, so:
- Answer in 2-4 short sentences that sound natural when spoken. Plain text only: no markdown, no bullet points, no headings, no URLs.
- Start with the answer itself. No preamble such as "Great question", "Sure", or "According to the slides".
- Reply in the language of the question (English, Urdu, or Roman Urdu).
- The question was transcribed from speech and may contain recognition errors; answer the most likely intended question.
- Be accurate. If something is uncertain or debated, say so briefly rather than guessing."""

LIVE_SYSTEM = f"""You are Flick, an assistant that helps a presenter answer audience questions live, during a presentation or lecture.

First check the presentation material in the message. If it answers the question, answer from it and do not search. If it does not cover the question, or the question needs current facts, use web search and answer from what you find. Do not write anything before searching.

{SPOKEN_RULES}"""

# ── Explaining a slide ──────────────────────────────────────────────────────

EXPLAIN_SYSTEM = """You are Flick, an assistant that explains a presentation slide out loud to the audience, on the presenter's behalf. Your words are read aloud by text-to-speech to a room of students or colleagues.

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
- Speak in the language of the request (English, Urdu, or Roman Urdu)."""


def explain_message(deck_name: str, slide: Slide, previous: Optional[Slide], next_: Optional[Slide], request: str) -> str:
    parts = [f"Presentation: {deck_name}"]
    if previous:
        parts.append(f"(For context) previous slide {previous.number}: {previous.title or '(untitled)'}")
    if next_:
        parts.append(f"(For context) next slide {next_.number}: {next_.title or '(untitled)'}")
    parts.append(f"<slide_to_explain>\n{format_slide(slide)}\n</slide_to_explain>")
    parts.append(f'The presenter said: "{request}"')
    return "\n\n".join(parts)


def live_message(
    question: str, deck: Optional[Deck], current_slide: Optional[int], recent: Sequence[tuple[str, str]]
) -> str:
    parts = [deck_context(deck, current_slide) if deck else "No presentation is loaded."]
    if current_slide:
        parts.append(f"The presenter is currently on slide {current_slide}.")
    if recent:
        parts.append("<recent_questions>\n" + "\n\n".join(f"Q: {q}\nA: {a}" for q, a in recent) + "\n</recent_questions>")
    parts.append(f"Audience question: {question}")
    return "\n\n".join(parts)


def deck_context(deck: Deck, current_slide: Optional[int]) -> str:
    """The deck as text. When it is too long, slides near the one on screen are kept first."""
    ordered = (
        sorted(deck.slides, key=lambda s: abs(s.number - current_slide)) if current_slide else list(deck.slides)
    )
    kept: list[Slide] = []
    used = 0
    for slide in ordered:
        size = len(format_slide(slide)) + 2
        if used + size > MAX_DECK_CONTEXT_CHARS:
            continue
        kept.append(slide)
        used += size
    kept.sort(key=lambda s: s.number)

    text = f'<presentation name="{deck.name}">\n' + "\n\n".join(format_slide(s) for s in kept) + "\n</presentation>"

    budget = max(0, MAX_DECK_CONTEXT_CHARS - used)
    lines, qa_used = [], 0
    for q in deck.predicted:
        line = f"Q (slide {q.slide}): {q.question}\nA: {q.answer}"
        if qa_used + len(line) > budget:
            break
        lines.append(line)
        qa_used += len(line) + 2
    if lines:
        text += "\n\n<prepared_answers>\n" + "\n\n".join(lines) + "\n</prepared_answers>"
    return text


def format_slide(slide: Slide) -> str:
    lines = [f"Slide {slide.number}: {slide.title or '(untitled)'}"]
    if slide.body:
        lines.append(slide.body)
    if slide.notes:
        lines.append(f"Speaker notes: {slide.notes}")
    return "\n".join(lines)
