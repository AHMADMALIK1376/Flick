"""Everything Flick does as a presentation assistant: loading decks, preparing
likely questions, answering live questions and explaining slides."""

from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path
from typing import Optional

from . import engine
from .db import Database
from .events import EventBus
from .llm import LLM, LLMError
from .models import Answer, Deck, PrepProgress
from .powerpoint import PowerPointBridge
from .pptx_reader import read_pptx
from .text import SlideTarget, clean_question, is_bare_address, is_nothing_heard, parse_slide_command

#: Earlier questions given to Claude so follow-ups ("explain that again") make sense.
RECENT_FOR_CONTEXT = 3
#: Older questions are a different conversation, not context.
RECENT_WINDOW_S = 10 * 60


class UserError(Exception):
    """A problem the presenter can fix. The message is shown as is."""


class FlickService:
    def __init__(self, db: Database, llm: LLM, bridge: PowerPointBridge, events: EventBus):
        self.db = db
        self.llm = llm
        self.bridge = bridge
        self.events = events
        self._preparing: set[str] = set()
        self._tasks: set[asyncio.Task] = set()

    # ── Decks ───────────────────────────────────────────────────────────────

    async def load_deck(self, file_path: str, data: Optional[bytes] = None, prepare: bool = True) -> Deck:
        """Reads a .pptx, makes it the active deck and starts preparing questions.
        Loading the same file again (after editing the slides) replaces the old copy."""
        if Path(file_path).suffix.lower() != ".pptx":
            raise UserError("Flick reads PowerPoint .pptx files. Save older .ppt files as .pptx first.")
        source = data if data is not None else file_path
        slides = await asyncio.to_thread(read_pptx, source)
        deck = Deck(
            id=self.db.find_deck_by_path(file_path) or str(uuid.uuid4()),
            name=Path(file_path).name,
            file_path=file_path,
            loaded_at=time.time(),
            slides=slides,
        )
        self.db.save_deck(deck, activate=True)
        if prepare:
            self._background(self.prepare_deck(deck.id))
        return deck

    async def load_deck_from_powerpoint(self) -> Deck:
        if not self.bridge.supported:
            raise UserError("Reading the open presentation works with PowerPoint on Windows. Use Upload instead.")
        path = await self.bridge.active_presentation_path()
        if not path:
            raise UserError("No open presentation found. Open your deck in PowerPoint first, or use Upload.")
        if not Path(path).is_absolute() or not Path(path).exists():
            raise UserError(
                "This presentation isn't saved on this computer yet (or is only in OneDrive). "
                "Save it locally, then try again."
            )
        return await self.load_deck(path)

    async def prepare_deck(self, deck_id: str) -> None:
        """Predicts likely audience questions. Safe to call repeatedly."""
        deck = self.db.get_deck(deck_id)
        if deck is None or deck_id in self._preparing:
            return
        self._preparing.add(deck_id)

        async def progress(done: int, total: int, status: str = "preparing", message: Optional[str] = None):
            self.events.publish(
                "prep_progress",
                PrepProgress(deck_id=deck_id, status=status, done=done, total=total, message=message).model_dump(),
            )

        try:
            self.db.set_prep_status(deck_id, "preparing")
            outcome = await engine.predict_questions(self.llm, deck.name, deck.slides, progress)
            if outcome.error:
                message = _friendly(outcome.error)
                self.db.set_prep_status(deck_id, "error", message)
                await progress(0, 0, "error", message)
                return
            self.db.replace_predicted(deck_id, outcome.questions)
            self.db.set_prep_status(deck_id, "ready")
            await progress(1, 1, "ready", f"{len(outcome.questions)} questions prepared.")
        except Exception as err:  # never leave a deck stuck in 'preparing'
            self.db.set_prep_status(deck_id, "error", str(err))
            await progress(0, 0, "error", str(err))
        finally:
            self._preparing.discard(deck_id)

    def active_deck(self) -> Optional[Deck]:
        deck_id = self.db.active_deck_id()
        return self.db.get_deck(deck_id) if deck_id else None

    # ── Live questions ──────────────────────────────────────────────────────

    def question_starting(self) -> None:
        """Called when the presenter starts speaking: look up the slide early."""
        self.bridge.prefetch_slide()

    async def ask(self, raw: str) -> Optional[Answer]:
        """Answers a spoken or typed question. None when nothing was heard."""
        if is_nothing_heard(raw):
            return None
        started = time.time()

        if is_bare_address(raw):
            answer = Answer(
                id=str(uuid.uuid4()),
                question=raw.strip(),
                answer="I'm here. Press the hotkey and ask the question.",
                origin="greeting",
                timestamp=started,
                speak=False,
            )
            self.events.publish("answer", answer.model_dump())
            return answer

        question = clean_question(raw)
        command = parse_slide_command(question)
        if command:
            return await self.explain_slide(command, question)

        self.events.publish("thinking", {"question": question})
        deck = self.active_deck()
        current_slide = await self.bridge.current_slide() if deck else None
        try:
            result = await engine.answer_question(self.llm, question, deck, current_slide, self._recent())
            answer = Answer(
                id=str(uuid.uuid4()),
                question=question,
                answer=result.answer,
                origin=result.origin,
                sources=result.sources,
                current_slide=current_slide,
                duration_ms=_ms_since(started),
                timestamp=started,
                speak=self.db.get_settings().answer_mode == "speak",
            )
        except LLMError as err:
            answer = self._error(question, _friendly(err), current_slide, started)
        return self._finish(answer, deck)

    async def explain_slide(
        self, target: SlideTarget = SlideTarget("current"), request: str = "Explain this slide to the audience."
    ) -> Answer:
        """Explains a slide to the audience. Always spoken: the presenter asked Flick to talk to the room."""
        started = time.time()
        deck = self.active_deck()
        if deck is None:
            return self._finish(
                self._error(request, "Load your presentation first, so I know what is on the slides.", None, started),
                None,
            )

        if target.kind == "number":
            number: Optional[int] = target.number
        else:
            on_screen = await self.bridge.current_slide(fresh=True)
            number = None if on_screen is None else on_screen + target.offset
        if number is None:
            message = (
                "I can't see which slide is on screen. Start the slideshow in PowerPoint, "
                'or say "explain slide 5". If the file is in Protected View, click Enable Editing.'
                if self.bridge.supported
                else 'I can only see the current slide in PowerPoint on Windows. Say "explain slide 5" instead.'
            )
            return self._finish(self._error(request, message, None, started), deck)

        slide = next((s for s in deck.slides if s.number == number), None)
        label = f"Explain slide {number}: {slide.title or 'untitled'}" if slide else f"Explain slide {number}"
        if slide is None:
            return self._finish(
                self._error(
                    label, f"This presentation has {len(deck.slides)} slides, so there is no slide {number}.", number, started
                ),
                deck,
            )

        self.events.publish("thinking", {"question": label})
        try:
            text = await engine.explain_slide(self.llm, deck, number, request)
        except LLMError as err:
            return self._finish(self._error(label, _friendly(err), number, started), deck)
        answer = Answer(
            id=str(uuid.uuid4()),
            question=label,
            answer=text,
            origin="explain",
            current_slide=number,
            duration_ms=_ms_since(started),
            timestamp=started,
            speak=True,
        )
        return self._finish(answer, deck)

    # ── Internals ───────────────────────────────────────────────────────────

    def _recent(self) -> list[tuple[str, str]]:
        entries = self.db.get_log(limit=20, since=time.time() - RECENT_WINDOW_S)
        useful = [e for e in entries if e.origin not in ("error", "greeting", "explain")]
        return [(e.question, e.answer) for e in reversed(useful[:RECENT_FOR_CONTEXT])]

    def _error(self, question: str, message: str, slide: Optional[int], started: float) -> Answer:
        # Never read an error aloud to the audience.
        return Answer(
            id=str(uuid.uuid4()),
            question=question,
            answer=message,
            origin="error",
            current_slide=slide,
            duration_ms=_ms_since(started),
            timestamp=started,
            speak=False,
        )

    def _finish(self, answer: Answer, deck: Optional[Deck]) -> Answer:
        self.db.add_log(answer, deck.id if deck else None)
        self.events.publish("answer", answer.model_dump())
        return answer

    def _background(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)


def _ms_since(started: float) -> int:
    return int((time.time() - started) * 1000)


def _friendly(err: LLMError) -> str:
    """A model/API failure as something the presenter can act on."""
    return {
        "missing_key": "I can't answer yet: add your Claude API key in Flick's Settings.",
        "invalid_key": "Your Claude API key was rejected. Check it in Settings.",
        "rate_limit": "Claude is busy right now. Try again in a few seconds.",
        "network": "I couldn't reach Claude. Check the internet connection.",
        "timeout": "That took too long to answer. Try asking again.",
        "no_slide": str(err),
    }.get(err.kind, f"Something went wrong: {err}")
