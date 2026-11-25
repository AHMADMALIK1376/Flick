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
import json
import time
import uuid
from pathlib import Path
from typing import Optional

import numpy as np

from . import engine, prompts, usage
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
    needs_routing,
    parse_draw_request,
    parse_slide_request,
    SlideRequest,
    parse_present_command,
    parse_slide_command,
)
from .transcribe import Transcriber
from .voice import Speaker, can_voice, split_sentences

#: Said while Flick searches the web, so the room isn't silent.
#: Said while Flick searches the web, so the room isn't left in silence. Rotates.
ONE_MOMENTS = [
    "One moment, let me check.",
    "Hmm, let me look that up quickly.",
    "Good one. Give me a second to check.",
    "Let me just check that for you.",
]
ONE_MOMENT = ONE_MOMENTS[0]
ONE_MOMENTS_BY_LANGUAGE = {
    "en": ONE_MOMENTS,
    "ur": ["ایک منٹ، ذرا دیکھ لیتے ہیں۔", "اچھا سوال ہے، ایک لمحہ۔", "ذرا چیک کر لیتے ہیں۔"],
    "mix": ["One second، ذرا check کر لیتے ہیں۔", "Good question، ایک minute۔", "اچھا، ایک second، یہ check کرتے ہیں۔"],
}
#: Earlier questions given to Claude so follow-ups ("explain that again") make sense.
RECENT_FOR_CONTEXT = 3
#: Older questions are a different conversation, not context.
RECENT_WINDOW_S = 10 * 60


ROUTER_MAX_TOKENS = 80
ROUTER_SYSTEM = """You route what someone said to Flick, an AI presenter, during a presentation.
Decide: is it a QUESTION to answer, or a REQUEST about a slide (go back to it, explain it again,
draw it, give an example of it)? If it is a request, pick the slide it is about from the list
(by number, or by topic: "the security part" → the slide about security; "this one" → the slide on screen).

Reply with ONLY JSON:
{"type": "question"}
or {"type": "slide", "slide": <number>, "action": "explain" | "goto", "board": "auto" | "draw" | "example"}
"explain": they want it explained again. "goto": they only want to see it. "draw": they asked to draw /
visualise it. "example": they asked for an example. When unsure, it is a question."""


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
        #: Token Analyzer: every Claude call is counted, by what it was for.
        self.usage = usage.UsageMeter(db, events)
        if hasattr(llm, "meter") and getattr(llm, "meter", None) is None:
            llm.meter = self.usage  # type: ignore[attr-defined]
        self.presenter = Presenter(self)
        #: Flick's voice changed since these decks were prepared: their explanations were reset.
        self.voice_refreshed = db.refresh_spoken_text(prompts.VOICE_VERSION)
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
        if self.voice_refreshed:
            jobs.append(self.rewrite_explanations())
        await asyncio.gather(*jobs, return_exceptions=True)

    async def rewrite_explanations(self, deck_id: Optional[str] = None) -> int:
        """Writes the active deck's slide explanations again (in Flick's current voice), so the
        next talk starts at once. Prepared questions are kept. → how many slides were written."""
        deck = self.db.get_deck(deck_id) if deck_id else self.active_deck()
        if deck is None or not deck.slides or not self.db.get_settings().anthropic_api_key:
            return 0

        async def save(batch: dict[int, str]) -> None:
            self.db.save_explanations(deck.id, batch)

        card = usage.LazyCard("prep", f"Rewriting {deck.name} in Flick's new voice", deck_id=deck.id, deck_name=deck.name)
        try:
            with usage.tagged(kind="prep", card=card, deck_id=deck.id):
                found = await engine.prepare_explanations(self.llm, deck.name, deck.slides, save)
        except Exception:
            return 0
        self._prevoice(deck.id)
        return len(found)

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
        deck = self.db.get_deck(deck_id)
        card = usage.LazyCard(
            "prep", f"Getting {deck.name if deck else 'the deck'} ready", deck_id=deck_id,
            deck_name=deck.name if deck else None, key=f"prep:{deck_id}:{int(time.time())}",
        )
        with usage.tagged(kind="prep", card=card, deck_id=deck_id):
            await self._prepare_deck(deck_id)

    async def _prepare_deck(self, deck_id: str) -> None:
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
        deck = self.active_deck()
        day = time.strftime("%Y-%m-%d")
        card = self.usage_card(
            "questions", f"Questions · {deck.name if deck else 'no deck'} · {time.strftime('%d %b')}", deck,
            key=f"questions:{deck.id if deck else '-'}:{day}",
        )
        style = self.presenter.style if self.presenter.active else None
        slide = self.presenter.slide if self.presenter.active else None
        try:
            with usage.tagged(kind="question", card=card, deck_id=deck.id if deck else None, style=style, slide=slide):
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
        request = parse_slide_request(question)
        if request is None and needs_routing(question):
            request = await self._route(question)  # "go over the RLS part again": Claude picks the slide
        if request is not None:
            handled = await self.slide_request(request, question, started)
            if handled is not None:
                return handled
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
            self._moments = getattr(self, "_moments", -1) + 1
            moments = ONE_MOMENTS_BY_LANGUAGE.get(self.talk_language()[0], ONE_MOMENTS)
            voiced = say_it and voice_on and self._say(moments[self._moments % len(moments)], epoch)
            self.events.publish("searching", {"id": answer_id, "speak": say_it, "voiced": voiced})

        try:
            result = await engine.answer_question(
                self.llm, question, deck, current_slide, self._recent(), self._semantic_match, on_text, on_search,
                *self.talk_language(),
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
        deck = self.active_deck()
        card = self.usage_card("slide", "Slide {slide} explained", deck)
        with usage.tagged(kind="explain", card=card):
            return await self._explain_slide(target, request)

    async def _explain_slide(
        self, target: SlideTarget, request: str
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

        usage.set_tag(slide=number)
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
        language, female = self.talk_language()
        # (Explanations written before the talk are English.)
        ready = self.db.get_explanation(deck.id, number) if is_plain_explain_request(request) and language == "en" else None
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
            text = await engine.explain_slide(self.llm, deck, number, request, on_text, language, female)
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

    def talk_language(self) -> tuple[str, bool]:
        """(the language Flick talks in: en | ur | mix, whether the Urdu voice is a woman's)."""
        settings = self.db.get_settings()
        return settings.talk_language, not settings.urdu_voice.startswith("hm")

    def usage_card(self, type: str, title: str, deck: Optional[Deck], key: Optional[str] = None) -> "str | usage.LazyCard | None":
        """The Token Analyzer card a call belongs to: the running talk's, or a new one."""
        if self.presenter.active and self.presenter.usage_card:
            return self.presenter.usage_card
        return usage.LazyCard(type, title, deck_id=deck.id if deck else None, deck_name=deck.name if deck else None, key=key)

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
        if not self._natural_voice() or self.talk_language()[0] != "en":
            return  # these texts are English: an Urdu talk writes and says its own
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

    def start_presenting(self, from_slide: Optional[int] = None, style: str = "class", board: Optional[str] = None) -> dict:
        """'Present for me': Flick gives the talk to the class, driving PowerPoint."""
        deck = self._check_can_present(self.active_deck())
        self.presenter.stop()
        self.speaker.stop()  # type: ignore[union-attr]
        self.presenter.start(deck, from_slide or 1, style=_style(style, board), study=False)
        return self.presenter.status()

    def start_study(
        self, style: str, from_slide: Optional[int] = None, deck_id: Optional[str] = None, board: Optional[str] = None
    ) -> dict:
        """A student's study session: Flick explains the deck in the chosen style (no PowerPoint)."""
        if deck_id:
            if self.db.get_deck(deck_id) is None:
                raise UserError("That presentation is no longer in Flick.")
            self.db.activate_deck(deck_id)
        deck = self._check_can_present(self.active_deck())
        self.presenter.stop()
        self.speaker.stop()  # type: ignore[union-attr]
        self.presenter.start(deck, from_slide or 1, style=_style(style, board), study=True)
        return self.presenter.status()

    # ── What Flick says per slide, and whether it draws ────────────────────

    async def slide_plan(self, deck: Deck, number: int, style: str) -> tuple[str, "Optional[asyncio.Future]"]:
        """→ (what to say for the slide, a future drawing or None). Cached per deck, slide and style."""
        key = (deck.id, number, style)
        task = self._plans.get(key)
        if task is None or (task.done() and task.exception() is not None):
            with usage.tagged(kind="talk", slide=number, style=style, deck_id=deck.id):
                task = asyncio.ensure_future(self._make_plan(deck, number, style))
            self._plans[key] = task
        try:
            text, drawing = await asyncio.shield(task)
        except Exception:
            self._plans.pop(key, None)
            slide = next((s for s in deck.slides if s.number == number), None)
            return (f"Let's look at {slide.title}." if slide and slide.title else ""), None
        if lessons.base_style(style) == "class" and lessons.language_of(style) == "en":
            job = self._drawing_job(deck, number, style, text)
        else:
            job = asyncio.get_running_loop().create_future()
            job.set_result(drawing)
        job.add_done_callback(lambda done: self._voice_drawing_early(done, number))
        return text, job

    def _voice_drawing_early(self, job: "asyncio.Future", number: int) -> None:
        """A drawing is ready: make the audio for its narration now, while Flick is still talking, so
        the steps follow each other without waiting. For the slide on screen it comes right after
        the slide's own sentences; for a later slide, in spare time."""
        if job.cancelled() or job.exception() is not None or not self.speaker or not self._natural_voice():
            return
        drawing = job.result()
        if drawing:
            says = [sentence for step in drawing.get("steps", []) for sentence in split_sentences(step.get("say", ""))]
            now = self.presenter.active and self.presenter.slide == number
            if now:  # "Let me draw this..." comes first: have it ready too
                says = self.presenter.draw_intro_lines() + says
            self.speaker.prefetch(says, urgent=now)

    async def _make_plan(self, deck: Deck, number: int, style: str) -> tuple[str, Optional[dict]]:
        if lessons.base_style(style) == "class" and lessons.language_of(style) == "en":
            return await self.slide_explanation(deck, number), None
        cached = self.db.get_lesson(deck.id, number, style)
        if cached is not None:
            return cached, self.db.get_drawing(deck.id, number, style)[1]
        previous = self.db.get_lesson(deck.id, number - 1, style)
        with usage.tagged(kind="talk", sink=[]) as tag:
            raw = await self.llm.complete(
                lessons.lesson_system(
                    style, study=lessons.is_study(style), language=lessons.language_of(style), female=self.talk_language()[1]
                ),
                lessons.lesson_message(deck, number, previous),
                lessons.LESSON_MAX_TOKENS,
            )
        text, drawing = lessons.parse_lesson(raw)
        if drawing and text:
            # One reply wrote both: show the drawing's part under "Whiteboard drawings".
            drawn = len(json.dumps(drawing, ensure_ascii=False))
            self.usage.split(tag.sink or [], "drawing", drawn / (drawn + len(text)))
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
                    lessons.draw_system(style, asked=False, language=lessons.language_of(style), female=self.talk_language()[1]),
                    lessons.draw_message(deck, slide, text, None),
                    lessons.DRAW_MAX_TOKENS,
                )
                result = lessons.parse_drawing(raw)
                self.db.save_drawing(deck.id, number, style, result)
                return result

            with usage.tagged(kind="drawing", slide=number, style=style, deck_id=deck.id):
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

    # ── "Go back to slide 6 and explain it again" ─────────────────────────────

    async def _route(self, question: str) -> Optional[SlideRequest]:
        """For a request like "go over the security part again": which slide, and what to do.
        Claude decides (a tiny, fast call). None → it's a normal question."""
        deck = self.active_deck()
        if deck is None or not deck.slides:
            return None
        current = self.presenter.slide if self.presenter.active else await self.bridge.current_slide()
        titles = "\n".join(f"{s.number}. {s.title or '(untitled)'}" for s in deck.slides)
        message = f"Slides:\n{titles}\n\nOn screen now: slide {current or 'unknown'}\n\nThey said: \"{question}\""
        try:
            with usage.tagged(kind="question", card=self.usage_card("questions", "Questions", deck)):
                raw = await self.llm.complete(ROUTER_SYSTEM, message, ROUTER_MAX_TOKENS)
        except LLMError:
            return None
        data = lessons._json_object(raw)
        if not data or data.get("type") != "slide":
            return None
        try:
            number = int(data.get("slide"))
        except (TypeError, ValueError):
            return None
        if not 1 <= number <= len(deck.slides):
            return None
        action = "goto" if data.get("action") == "goto" else "explain"
        board = data.get("board") if data.get("board") in ("draw", "example") else "auto"
        return SlideRequest(SlideTarget("number", number=number), action, board)

    async def slide_request(self, request: SlideRequest, question: str, started: float) -> Optional[Answer]:
        """Goes to a slide and (for 'explain') explains it again, then comes back. During a talk the
        presenter does it; otherwise Flick moves PowerPoint, explains, and returns to the slide that
        was on screen. None → not possible here (answered as a normal request instead)."""
        deck = self.active_deck()
        if deck is None:
            return None
        presenting = self.presenter.active
        here = self.presenter.slide if presenting else await self.bridge.current_slide(fresh=True)
        target = request.target
        if target.kind == "number":
            number: Optional[int] = target.number
        elif here is None:
            number = None
        else:
            number = here + (target.offset if target.kind == "relative" else 0)
        if number is None or not 1 <= number <= len(deck.slides):
            if number is not None:
                return self._finish(
                    self._error(question, f"This presentation has {len(deck.slides)} slides, so there is no slide {number}.", None, started),
                    deck,
                )
            return None

        def note(text: str) -> Answer:  # shown on the card; Flick says it itself
            answer = Answer(id=str(uuid.uuid4()), question=question, answer=text, origin="explain",
                            current_slide=number, timestamp=started, speak=False,
                            duration_ms=_ms_since(started))
            self.events.publish("answer", answer.model_dump())
            self.db.add_log(answer, deck.id)
            return answer

        if presenting:
            if request.action == "goto":
                self.presenter.jump_to(number)
                return note(f"Going to slide {number}. The talk carries on from there.")
            back = self.presenter.revisit(number, request.board, question)
            extra = {"draw": " with a drawing", "example": " with a real-life example"}.get(request.board, "")
            then = f" then back to slide {back}" if back and back != number else " then carry on"
            return note(f"Explaining slide {number} again{extra},{then}.")

        # Not presenting: move PowerPoint, explain, come back.
        if request.action == "goto":
            problem = await self.bridge.show_slide(number, deck.file_path, deck.name) if self.bridge.supported else None
            if problem:
                return self._finish(self._error(question, problem, None, started), deck)
            return note(f"Showing slide {number}.")
        if self.bridge.supported and number != here:
            await self.bridge.show_slide(number, deck.file_path, deck.name)
        answer = await self.explain_slide(SlideTarget("number", number=number), question)
        if answer.origin == "error":
            return answer
        # "Explain slide 6" from slide 8: come back to 8 afterwards. "Explain the next slide": stay there.
        back = here if target.kind == "number" else None
        self._background(self._after_explaining(request, question, number, back, deck))
        return answer

    async def _after_explaining(self, request: SlideRequest, question: str, number: int, back: Optional[int], deck: Deck) -> None:
        """After "explain slide 6 again": draw it if they asked, then show the slide they were on."""
        try:
            await self.wait_until_quiet()
            if request.board != "auto":
                kind = "example" if request.board == "example" else "draw"
                await self._draw_on_request(kind, question, time.time(), slide_number=number)
                await self.wait_until_quiet()
            if back and back != number and self.bridge.supported and not self.presenter.active:
                await self.bridge.show_slide(back, deck.file_path, deck.name)
        except Exception:
            pass

    def fresh_explanation(self, deck: Deck, number: int, plan_key: str, request: Optional[str]) -> "asyncio.Future":
        """ "Explain slide 6 again": a teacher doesn't repeat themselves word for word. A new
        explanation, simpler and with a different example, written while Flick says "Sure, let's go back"."""
        old = self.db.get_lesson(deck.id, number, plan_key) or self.db.get_explanation(deck.id, number) or ""
        base = lessons.base_style(plan_key)
        ask = (
            f'Someone asked to go over this again ("{request or "explain it again"}"). Explain it again in a '
            "DIFFERENT way: simpler, starting from the part that usually confuses people, with a new example or "
            "analogy. About 70 to 140 words. Don't open with a greeting or with \"sure\" (Flick already said it)."
        )
        if old:
            ask += f' Last time you said: "{old[:1200]}". Do not reuse those sentences or that example.'
        if base != "class":
            ask += f" Keep the {lessons.STYLES[base]} style."
        if lessons.is_study(plan_key):
            ask += " You are talking to one student, like a friend sitting next to them."

        async def make() -> str:
            return await engine.explain_slide(
                self.llm, deck, number, ask, language=lessons.language_of(plan_key), female=self.talk_language()[1]
            )

        with usage.tagged(kind="explain", slide=number, style=plan_key, deck_id=deck.id):
            return asyncio.ensure_future(make())

    def requested_drawing(self, deck: Deck, number: int, style: str, board: str, request: Optional[str]) -> "asyncio.Future":
        """A drawing someone asked for during the talk ("...and draw it", "...with an example")."""
        slide = next((s for s in deck.slides if s.number == number), None)
        context = self.db.get_lesson(deck.id, number, style) or self.db.get_explanation(deck.id, number)
        ask = request or ("Draw a real-life example of this slide." if board == "example" else "Draw this slide.")
        if board == "example" and "example" not in ask.lower():
            ask += " (Draw a concrete real-life example.)"

        async def make() -> Optional[dict]:
            raw = await self.llm.complete(
                lessons.draw_system(style, asked=True, language=lessons.language_of(style), female=self.talk_language()[1]),
                lessons.draw_message(deck, slide, context, ask), lessons.DRAW_MAX_TOKENS
            )
            return lessons.parse_drawing(raw)

        with usage.tagged(kind="example" if board == "example" else "drawing", slide=number, style=style, deck_id=deck.id):
            return asyncio.ensure_future(make())

    # ── "Draw this" / "give me an example" / "explain with a story" ─────────

    async def _draw_on_request(
        self, kind: str, question: str, started: float, slide_number: Optional[int] = None
    ) -> Optional[Answer]:
        """Draws on the whiteboard and explains it step by step. None → answer in words instead."""
        deck = self.active_deck()
        if deck is None:
            return None
        presenting = self.presenter.active
        number = slide_number or (self.presenter.slide if presenting else await self.bridge.current_slide())
        slide = next((s for s in deck.slides if s.number == number), None) if number else None
        style = "story" if kind == "story" else (lessons.base_style(self.presenter.style) if presenting else "class")
        context = None
        if number:
            context = self.db.get_lesson(deck.id, number, style) or self.db.get_explanation(deck.id, number)
        answer_id = str(uuid.uuid4())
        self.events.publish("thinking", {"id": answer_id, "question": question})
        card = self.usage_card("slide", "Example drawn · slide {slide}", deck)
        try:
            with usage.tagged(kind="example", card=card, slide=number, style=style):
                raw = await self.llm.complete(
                    lessons.draw_system(style, asked=True, language=self.talk_language()[0], female=self.talk_language()[1]),
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


def _style(style: Optional[str], board: Optional[str] = None) -> str:
    """A mode plus the whiteboard option: "story" + "example" → "story+example"."""
    base, given = lessons.split_style(style or "class")
    return lessons.make_style(base, board or given)


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
