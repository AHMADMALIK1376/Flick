"""Everything Flick does as a presentation assistant: loading decks, preparing
likely questions and slide explanations, answering live questions and
explaining slides.

Speed is the point, so:
- prepared answers are matched by words (instant) and by meaning (~20 ms);
- slide explanations are written before the talk, so "explain this slide"
  starts at once;
- live answers are streamed sentence by sentence ("answer_delta" events), so
  speech starts after the first sentence;
- the speech model, the meaning model and the Claude connection are warmed up
  at startup, not on the first question.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path
from typing import Optional

import numpy as np

from . import engine
from .db import Database
from .events import EventBus
from .llm import LLM, LLMError
from .models import Answer, Deck, PredictedQuestion, PrepProgress
from .powerpoint import PowerPointBridge
from . import lessons
from .presenter import Presenter
from .pptx_reader import read_pptx
from .semantic import Embedder, best_semantic_match, to_blob
from .text import (
    SlideTarget,
    clean_question,
    is_bare_address,
    is_nothing_heard,
    is_plain_explain_request,
    parse_draw_request,
    parse_present_command,
    parse_slide_command,
)
from .transcribe import Transcriber
from .voice import Speaker, can_voice, split_sentences

#: Said while Flick searches the web, so the room isn't silent.
ONE_MOMENT = "One moment, let me check."
#: Earlier questions given to Claude so follow-ups ("explain that again") make sense.
RECENT_FOR_CONTEXT = 3
#: Older questions are a different conversation, not context.
RECENT_WINDOW_S = 10 * 60


class UserError(Exception):
    """A problem the presenter can fix. The message is shown as is."""


class FlickService:
    def __init__(
        self,
        db: Database,
        llm: LLM,
        bridge: PowerPointBridge,
        events: EventBus,
        embedder: Optional[Embedder] = None,
        transcriber: Optional[Transcriber] = None,
        speaker: Optional[Speaker] = None,
    ):
        self.db = db
        self.llm = llm
        self.bridge = bridge
        self.events = events
        self.embedder = embedder
        self.transcriber = transcriber
        self.speaker = speaker
        self.presenter = Presenter(self)
        self._plans: dict[tuple[str, int, str], asyncio.Task] = {}  # slide plans being made
        self._drawings: dict[tuple[str, int, str], asyncio.Task] = {}  # drawing decisions being made
        self._narration: Optional[asyncio.Task] = None  # a drawing being explained on request
        self._preparing: set[str] = set()
        self._tasks: set[asyncio.Task] = set()

    # ── Startup ─────────────────────────────────────────────────────────────

    async def warm_up(self) -> None:
        """Load models and open the Claude connection in the background, so the first question is fast."""
        jobs = []
        warm = getattr(self.llm, "warm_up", None)
        if warm:
            jobs.append(warm())
        if self.transcriber:
            jobs.append(asyncio.to_thread(self.transcriber.load, self.db.get_settings().speech_model))
        if self.embedder and hasattr(self.embedder, "load"):
            jobs.append(self._load_embedder_and_index())
        if self.speaker:
            jobs.append(self._load_voice())
        await asyncio.gather(*jobs, return_exceptions=True)

    async def _load_voice(self) -> None:
        await asyncio.to_thread(self.speaker.voice.load)  # type: ignore[union-attr]
        deck = self.active_deck()
        if deck:
            self._prevoice(deck.id)

    async def _load_embedder_and_index(self) -> None:
        await asyncio.to_thread(self.embedder.load)  # type: ignore[union-attr]
        deck = self.active_deck()
        if deck:
            await self._index_questions(deck)

    # ── Decks ───────────────────────────────────────────────────────────────

    async def load_deck(self, file_path: str, data: Optional[bytes] = None, prepare: bool = True) -> Deck:
        """Reads a .pptx, makes it the active deck and starts preparing.
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
        """
        Before the talk: predicts likely questions, indexes them by meaning, then
        writes every slide's explanation. Safe to call repeatedly.
        """
        deck = self.db.get_deck(deck_id)
        if deck is None or deck_id in self._preparing:
            return
        self._preparing.add(deck_id)
        question_batches = -(-len(deck.slides) // engine.SLIDES_PER_BATCH)
        explain_batches = -(-len(deck.slides) // engine.SLIDES_PER_EXPLAIN_BATCH)
        total = question_batches + explain_batches
        done_explain = 0

        def progress(done: int, status: str = "preparing", message: Optional[str] = None) -> None:
            self.events.publish(
                "prep_progress",
                PrepProgress(deck_id=deck_id, status=status, done=done, total=total, message=message).model_dump(),
            )

        async def on_questions(done: int, _total: int) -> None:
            progress(done, message="Predicting audience questions…")

        async def on_explained(batch: dict[int, str]) -> None:
            nonlocal done_explain
            self.db.save_explanations(deck_id, batch)
            done_explain += 1
            progress(question_batches + done_explain, message="Writing slide explanations…")

        try:
            self.db.set_prep_status(deck_id, "preparing")
            outcome = await engine.predict_questions(self.llm, deck.name, deck.slides, on_questions)
            if outcome.error:
                message = _friendly(outcome.error)
                self.db.set_prep_status(deck_id, "error", message)
                progress(0, "error", message)
                return
            self.db.replace_predicted(deck_id, outcome.questions)
            deck = self.db.get_deck(deck_id) or deck
            await self._index_questions(deck)

            await engine.prepare_explanations(self.llm, deck.name, deck.slides, on_explained)
            self.db.set_prep_status(deck_id, "ready")
            self._prevoice(deck_id)
            progress(
                total,
                "ready",
                f"{len(outcome.questions)} questions and {self.db.explanation_count(deck_id)} slide explanations ready.",
            )
        except Exception as err:  # never leave a deck stuck in 'preparing'
            self.db.set_prep_status(deck_id, "error", str(err))
            progress(0, "error", str(err))
        finally:
            self._preparing.discard(deck_id)

    def active_deck(self) -> Optional[Deck]:
        deck_id = self.db.active_deck_id()
        return self.db.get_deck(deck_id) if deck_id else None

    # ── Matching by meaning ─────────────────────────────────────────────────

    def _embedder_ready(self) -> bool:
        return bool(self.embedder and self.embedder.ready())

    async def _index_questions(self, deck: Deck) -> None:
        """Stores a meaning vector for every prepared question that lacks one."""
        if not self._embedder_ready() or not deck.predicted:
            return
        have = self.db.get_embeddings(deck.id, self.embedder.name)  # type: ignore[union-attr]
        missing = [q for q in deck.predicted if q.id not in have]
        if not missing:
            return
        vectors = await asyncio.to_thread(self.embedder.embed, [q.question for q in missing])  # type: ignore[union-attr]
        self.db.save_embeddings(self.embedder.name, {q.id: to_blob(v) for q, v in zip(missing, vectors)})  # type: ignore[union-attr]

    async def _semantic_match(self, question: str, deck: Deck) -> Optional[PredictedQuestion]:
        if not self._embedder_ready():
            return None  # model still loading: word matching and Claude cover it
        await self._index_questions(deck)
        vectors = self.db.get_embeddings(deck.id, self.embedder.name)  # type: ignore[union-attr]
        query: np.ndarray = (await asyncio.to_thread(self.embedder.embed, [question]))[0]  # type: ignore[union-attr]
        match = best_semantic_match(query, deck.predicted, vectors)
        return match.item if match else None

    # ── Live questions ──────────────────────────────────────────────────────

    def question_starting(self) -> None:
        """Called when someone starts asking (mic / hotkey): look up the slide early, and
        stop talking. While presenting this is a raised hand: Flick pauses and continues
        by itself once the question is answered."""
        self.bridge.prefetch_slide()
        if self.presenter.state in ("presenting", "starting"):
            self.presenter.pause("question")
        elif self.speaker:
            self.speaker.stop()

    async def transcribe(self, audio: bytes) -> tuple[str, int]:
        if self.transcriber is None:
            raise UserError("Speech recognition is not available.")
        settings = self.db.get_settings()
        deck = self.active_deck()
        hint = ", ".join(s.title for s in deck.slides if s.title) if deck else ""
        return await asyncio.to_thread(
            self.transcriber.transcribe, audio, settings.speech_model, settings.language, hint
        )

    async def ask(self, raw: str) -> Optional[Answer]:
        """Answers a spoken or typed question. None when nothing was heard."""
        try:
            return await self._ask(raw)
        finally:
            # A raised hand during the talk: continue once the answer has been said.
            if self.presenter.paused_for == "question":
                self._background(self.presenter.question_answered())

    async def _ask(self, raw: str) -> Optional[Answer]:
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
        present = parse_present_command(question, self.presenter.active)
        if present:
            return self._present_command(present, question, started)
        command = parse_slide_command(question)
        if command:
            return await self.explain_slide(command, question)

        # A question during the talk (typed, or asked without the hotkey) also pauses it.
        if self.presenter.state in ("presenting", "starting"):
            self.presenter.pause("question")
        elif self.speaker:
            self.speaker.stop()

        draw = parse_draw_request(question)
        if draw:
            drawn = await self._draw_on_request(draw, question, started)
            if drawn:
                return drawn  # otherwise: answer it in words below

        answer_id = str(uuid.uuid4())
        speak = self.db.get_settings().answer_mode == "speak"
        voice_on = speak and self._natural_voice()
        epoch = self.speech_epoch()
        voiced_any = False
        self.events.publish("thinking", {"id": answer_id, "question": question})
        deck = self.active_deck()
        current_slide = await self.bridge.current_slide() if deck else None
        streamed = False

        async def on_text(sentence: str) -> None:
            nonlocal streamed, voiced_any
            streamed = True
            voiced = voice_on and self._say(sentence, epoch)
            voiced_any = voiced_any or voiced
            self.events.publish("answer_delta", {"id": answer_id, "text": sentence, "speak": speak, "voiced": voiced})

        async def on_search() -> None:
            # "One moment, let me check" — only if nothing has been said yet.
            say_it = speak and not streamed
            voiced = say_it and voice_on and self._say(ONE_MOMENT, epoch)
            self.events.publish("searching", {"id": answer_id, "speak": say_it, "voiced": voiced})

        try:
            result = await engine.answer_question(
                self.llm, question, deck, current_slide, self._recent(), self._semantic_match, on_text, on_search
            )
            answer = Answer(
                id=answer_id,
                question=question,
                answer=result.answer,
                origin=result.origin,
                sources=result.sources,
                current_slide=current_slide,
                duration_ms=_ms_since(started),
                timestamp=started,
                speak=speak,
                streamed=streamed,
                voiced=voiced_any,
            )
        except LLMError as err:
            answer = self._error(question, _friendly(err), current_slide, started, answer_id)
        return self._finish(answer, deck, voice=voice_on, epoch=epoch)

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

        answer_id = str(uuid.uuid4())

        # Written before the talk: starts at once.
        ready = self.db.get_explanation(deck.id, number) if is_plain_explain_request(request) else None
        voice_on = self._natural_voice()
        if self.speaker and not self.presenter.active:
            self.speaker.stop()
        epoch = self.speech_epoch()
        if ready:
            return self._finish(
                Answer(
                    id=answer_id,
                    question=label,
                    answer=ready,
                    origin="explain",
                    current_slide=number,
                    duration_ms=_ms_since(started),
                    timestamp=started,
                    speak=True,
                ),
                deck,
                voice=voice_on,
                epoch=epoch,
            )

        # Not ready yet, or a special request ("in Urdu", "in simple words"): write it now, streamed.
        self.events.publish("thinking", {"id": answer_id, "question": label})
        streamed = False

        voiced_any = False

        async def on_text(sentence: str) -> None:
            nonlocal streamed, voiced_any
            streamed = True
            voiced = voice_on and self._say(sentence, epoch)
            voiced_any = voiced_any or voiced
            self.events.publish("answer_delta", {"id": answer_id, "text": sentence, "speak": True, "voiced": voiced})

        try:
            text = await engine.explain_slide(self.llm, deck, number, request, on_text)
        except LLMError as err:
            return self._finish(self._error(label, _friendly(err), number, started, answer_id), deck)
        return self._finish(
            Answer(
                id=answer_id,
                question=label,
                answer=text,
                origin="explain",
                current_slide=number,
                duration_ms=_ms_since(started),
                timestamp=started,
                speak=True,
                streamed=streamed,
                voiced=voiced_any,
            ),
            deck,
            voice=voice_on,
            epoch=epoch,
        )

    # ── Internals ───────────────────────────────────────────────────────────

    def _recent(self) -> list[tuple[str, str]]:
        entries = self.db.get_log(limit=20, since=time.time() - RECENT_WINDOW_S)
        useful = [e for e in entries if e.origin not in ("error", "greeting", "explain")]
        return [(e.question, e.answer) for e in reversed(useful[:RECENT_FOR_CONTEXT])]

    def _error(
        self, question: str, message: str, slide: Optional[int], started: float, answer_id: Optional[str] = None
    ) -> Answer:
        # Never read an error aloud to the audience.
        return Answer(
            id=answer_id or str(uuid.uuid4()),
            question=question,
            answer=message,
            origin="error",
            current_slide=slide,
            duration_ms=_ms_since(started),
            timestamp=started,
            speak=False,
        )

    def _finish(self, answer: Answer, deck: Optional[Deck], voice: bool = False, epoch: Optional[int] = None) -> Answer:
        # Prepared answers and ready explanations arrive whole: say them now (never errors).
        if (
            voice
            and answer.speak
            and not answer.streamed
            and answer.origin not in ("error", "greeting")
            and can_voice(answer.answer)
        ):
            if epoch is None or self.speaker is None or epoch == self.speaker.epoch:
                for sentence in split_sentences(answer.answer):
                    self._say(sentence)
                answer.voiced = True
        self.db.add_log(answer, deck.id if deck else None)
        self.events.publish("answer", answer.model_dump())
        return answer

    # ── Voice ───────────────────────────────────────────────────────────────

    def _natural_voice(self) -> bool:
        """Flick's own voice is on and loaded (otherwise the screens use the Windows voice)."""
        return bool(self.speaker and self.speaker.available() and self.db.get_settings().voice == "natural")

    def _say(self, text: str, epoch: Optional[int] = None) -> bool:
        """Queues a sentence in Flick's voice. False if this text can't be voiced (e.g. Urdu script),
        or if Stop was pressed since this answer started (`epoch` changed)."""
        if not self.speaker or not can_voice(text):
            return False
        if epoch is not None and epoch != self.speaker.epoch:
            return False
        self.speaker.say(text)
        return True

    def speech_epoch(self) -> int:
        return self.speaker.epoch if self.speaker else 0

    def stop_talking(self) -> None:
        """The Stop button: silence at once (answer, explanation or drawing). A talk in
        progress is paused, not ended."""
        if self.presenter.state in ("presenting", "starting"):
            self.presenter.pause("manual")
        if self.speaker:
            self.speaker.stop()

    def voice_status(self) -> dict:
        voice = getattr(self.speaker, "voice", None)
        return {
            "ready": bool(self.speaker and self.speaker.available()),
            "error": getattr(voice, "error", None),
            "downloading": bool(getattr(voice, "downloading", False)),
        }

    def _prevoice(self, deck_id: str) -> None:
        """Makes audio ahead of time, so it plays at once: every slide explanation first
        (presenting), then every prepared answer (questions). Uses the spare queue only."""
        if not self._natural_voice():
            return
        for text in self.db.get_explanations(deck_id).values():
            self.speaker.prefetch(split_sentences(text))  # type: ignore[union-attr]
        deck = self.db.get_deck(deck_id)
        for q in deck.predicted if deck else []:
            self.speaker.prefetch(split_sentences(q.answer))  # type: ignore[union-attr]

    # ── Presenting ("Flick, present this for me") ───────────────────────────

    async def slide_explanation(self, deck: Deck, number: int) -> str:
        """The spoken explanation of a slide: written before the talk, or now if missing."""
        ready = self.db.get_explanation(deck.id, number)
        if ready:
            return ready
        try:
            text = await engine.explain_slide(self.llm, deck, number, "Explain this slide to the audience.")
        except LLMError:
            slide = next((s for s in deck.slides if s.number == number), None)
            return f"Let's look at {slide.title}." if slide and slide.title else ""
        if text.strip():
            self.db.save_explanations(deck.id, {number: text})
        return text

    def _check_can_present(self, deck: Optional[Deck]) -> Deck:
        if deck is None or not deck.slides:
            raise UserError("Load your presentation first, so I know what to present.")
        if self.db.get_settings().voice != "natural":
            raise UserError("Presenting needs Flick's natural voice. Turn it on in Settings → Voice.")
        if not self.speaker or not self.speaker.available():
            status = self.voice_status()
            if status["error"]:
                raise UserError(status["error"])
            raise UserError("Flick's voice is still getting ready (first start only). Try again in a minute.")
        return deck

    def start_presenting(self, from_slide: Optional[int] = None, style: str = "class") -> dict:
        """'Present for me': Flick gives the talk to the class, driving PowerPoint."""
        deck = self._check_can_present(self.active_deck())
        self.presenter.stop()
        self.speaker.stop()  # type: ignore[union-attr]
        self.presenter.start(deck, from_slide or 1, style=_style(style), study=False)
        return self.presenter.status()

    def start_study(self, style: str, from_slide: Optional[int] = None, deck_id: Optional[str] = None) -> dict:
        """A student's study session: Flick explains the deck in the chosen style (no PowerPoint)."""
        if deck_id:
            if self.db.get_deck(deck_id) is None:
                raise UserError("That presentation is no longer in Flick.")
            self.db.activate_deck(deck_id)
        deck = self._check_can_present(self.active_deck())
        self.presenter.stop()
        self.speaker.stop()  # type: ignore[union-attr]
        self.presenter.start(deck, from_slide or 1, style=_style(style), study=True)
        return self.presenter.status()

    # ── What Flick says per slide, and whether it draws ────────────────────

    async def slide_plan(self, deck: Deck, number: int, style: str) -> tuple[str, "Optional[asyncio.Future]"]:
        """→ (what to say for the slide, a future drawing or None). Cached per deck, slide and style."""
        key = (deck.id, number, style)
        task = self._plans.get(key)
        if task is None or (task.done() and task.exception() is not None):
            task = asyncio.ensure_future(self._make_plan(deck, number, style))
            self._plans[key] = task
        try:
            text, drawing = await asyncio.shield(task)
        except Exception:
            self._plans.pop(key, None)
            slide = next((s for s in deck.slides if s.number == number), None)
            return (f"Let's look at {slide.title}." if slide and slide.title else ""), None
        if style == "class":
            return text, self._drawing_job(deck, number, style, text)
        done: asyncio.Future = asyncio.get_running_loop().create_future()
        done.set_result(drawing)
        return text, done

    async def _make_plan(self, deck: Deck, number: int, style: str) -> tuple[str, Optional[dict]]:
        if style == "class":
            return await self.slide_explanation(deck, number), None
        cached = self.db.get_lesson(deck.id, number, style)
        if cached is not None:
            return cached, self.db.get_drawing(deck.id, number, style)[1]
        previous = self.db.get_lesson(deck.id, number - 1, style)
        raw = await self.llm.complete(
            lessons.lesson_system(style), lessons.lesson_message(deck, number, previous), lessons.LESSON_MAX_TOKENS
        )
        text, drawing = lessons.parse_lesson(raw)
        if not text:
            raise LLMError("empty_response", "no lesson text")
        self.db.save_lesson(deck.id, number, style, text)
        self.db.save_drawing(deck.id, number, style, drawing)
        return text, drawing

    def _drawing_job(self, deck: Deck, number: int, style: str, text: str) -> "asyncio.Future":
        """Decides (once, then cached) whether this slide needs a drawing, and plans it."""
        decided, drawing = self.db.get_drawing(deck.id, number, style)
        if decided:
            done: asyncio.Future = asyncio.get_running_loop().create_future()
            done.set_result(drawing)
            return done
        key = (deck.id, number, style)
        task = self._drawings.get(key)
        if task is None or (task.done() and task.exception() is not None):

            async def decide() -> Optional[dict]:
                slide = next((s for s in deck.slides if s.number == number), None)
                raw = await self.llm.complete(
                    lessons.draw_system(style, asked=False),
                    lessons.draw_message(deck, slide, text, None),
                    lessons.DRAW_MAX_TOKENS,
                )
                result = lessons.parse_drawing(raw)
                self.db.save_drawing(deck.id, number, style, result)
                return result

            task = asyncio.ensure_future(decide())
            self._drawings[key] = task
        return task

    def prefetch_slide_plan(self, deck: Deck, number: int, style: str) -> None:
        """Gets the next slide ready (text, audio and drawing) while the current one is being said."""
        if number > len(deck.slides):
            return

        async def job() -> None:
            try:
                text, drawing_job = await self.slide_plan(deck, number, style)
                if self.speaker:
                    self.speaker.prefetch(split_sentences(text))
                if drawing_job is not None:
                    await drawing_job
            except Exception:
                pass

        self._background(job())

    async def wait_until_quiet(self) -> None:
        """Waits until Flick has finished saying (and drawing) its answer."""
        if self._narration is not None and not self._narration.done():
            try:
                await self._narration
            except Exception:
                pass
        if self.speaker:
            await self.speaker.idle()

    # ── "Draw this" / "give me an example" / "explain with a story" ─────────

    async def _draw_on_request(self, kind: str, question: str, started: float) -> Optional[Answer]:
        """Draws on the whiteboard and explains it step by step. None → answer in words instead."""
        deck = self.active_deck()
        if deck is None:
            return None
        presenting = self.presenter.active
        number = self.presenter.slide if presenting else await self.bridge.current_slide()
        slide = next((s for s in deck.slides if s.number == number), None) if number else None
        style = "story" if kind == "story" else (self.presenter.style if presenting else "class")
        context = None
        if number:
            context = self.db.get_lesson(deck.id, number, style) or self.db.get_explanation(deck.id, number)
        answer_id = str(uuid.uuid4())
        self.events.publish("thinking", {"id": answer_id, "question": question})
        try:
            raw = await self.llm.complete(
                lessons.draw_system(style, asked=True),
                lessons.draw_message(deck, slide, context, question),
                lessons.DRAW_MAX_TOKENS,
            )
        except LLMError:
            return None
        drawing = lessons.parse_drawing(raw)
        if drawing is None:
            return None

        target = self.presenter.target if presenting else "class"
        study = presenting and self.presenter.study
        speak = study or self.db.get_settings().answer_mode == "speak"
        voiced = speak and self._natural_voice()
        canvas_id = str(uuid.uuid4())
        self.events.publish("canvas", {"action": "open", "id": canvas_id, "slide": number, "target": target, **drawing})
        self._narration = asyncio.ensure_future(self._narrate(canvas_id, drawing, voiced, target, presenting))

        answer = Answer(
            id=answer_id,
            question=question,
            answer=" ".join(step["say"] for step in drawing["steps"]),
            origin="example",
            current_slide=number,
            duration_ms=_ms_since(started),
            timestamp=started,
            speak=speak,
            streamed=False,
            voiced=voiced,
        )
        self.db.add_log(answer, deck.id)
        self.events.publish("answer", answer.model_dump())
        return answer

    async def _narrate(self, canvas_id: str, drawing: dict, voiced: bool, target: str, close_after: bool) -> None:
        """Reveals the drawing step by step while saying each step."""
        for number, step in enumerate(drawing["steps"], start=1):
            self.events.publish("canvas", {"action": "step", "id": canvas_id, "step": number, "say": step["say"], "target": target})
            if voiced:
                for sentence in split_sentences(step["say"]):
                    if can_voice(sentence) and not await self.speaker.say(sentence):  # type: ignore[union-attr]
                        return  # stopped: a new question, or the talk moved on
            else:
                await asyncio.sleep(max(2.5, len(step["say"].split()) / 2.6))
        if close_after:  # back to the talk: put the whiteboard away
            await asyncio.sleep(1.5)
            self.events.publish("canvas", {"action": "close", "id": canvas_id, "target": target})

    def _present_command(self, command: str, question: str, started: float) -> Answer:
        """Handles "present this", "stop presenting", "continue", "next / previous slide"."""
        message = {
            "start": "Starting the presentation.",
            "stop": "Stopped presenting.",
            "continue": "Continuing.",
            "next": "Next slide.",
            "previous": "Previous slide.",
        }[command]
        try:
            if command == "start":
                self.start_presenting()
            elif command == "stop":
                self.presenter.stop()
                if self.speaker:
                    self.speaker.stop()
            elif command == "continue":
                self.presenter.resume()
            else:
                self.presenter.go(1 if command == "next" else -1)
        except UserError as err:
            return self._finish(self._error(question, str(err), None, started), self.active_deck())
        # Not a real answer: nothing to show or say.
        return Answer(
            id=str(uuid.uuid4()), question=question, answer=message, origin="greeting", timestamp=started, speak=False
        )

    def _background(self, coro) -> None:
        task = asyncio.ensure_future(coro)
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)


def _style(style: Optional[str]) -> str:
    return style if style in lessons.STYLES else "class"


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
