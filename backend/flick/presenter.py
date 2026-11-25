"""Flick gives the talk: "Present for me" (in class) and study sessions (for students).

    for each slide: (class: show it in PowerPoint) → say what it's about, sentence by sentence
                  → if the idea is complex: draw it on the whiteboard, step by step, while talking
                  → next slide … → closing line

Raise hand (the Ask hotkey, the mic, the Pause button, or asking on the Study page) pauses at once.
When the question has been answered Flick says "Let's continue." and goes on from the sentence it
was saying. Next / Previous / Stop work at any time.

Events: "present" (slide, state, caption) and "canvas" (open / step / close the whiteboard).
"""

from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal, Optional

from .models import Deck
from . import usage
from .voice import split_sentences

if TYPE_CHECKING:
    from .service import FlickService

State = Literal["idle", "starting", "presenting", "paused", "finished", "error"]

#: If someone raised a hand but no question arrives, continue after this long.
QUESTION_WAIT_S = 75.0  # speak, read it back, edit, press ✓
#: Breath between slides.
SLIDE_GAP_S = 0.6
#: After a slide was explained, how long to wait for a drawing that is still being planned.
DRAWING_WAIT_S = 6.0

GREETING = "Hello everyone."
STUDY_GREETING = "Let's study this together."
CONTINUE = "Now, let's continue."
CLOSING = "That's the end of the presentation. Thank you for listening! Are there any questions?"
STUDY_CLOSING = "That's the whole presentation. Well done! Ask me anything you'd like to go over again."
DRAW_INTRO = {"story": "Let me draw this part of the story."}
DRAW_INTRO_DEFAULT = "Let me draw this to make it clearer."
#: The first slide's text may already greet the room: then Flick doesn't greet twice.
_GREETS = re.compile(r"^(hello|hi\b|hey\b|good (morning|afternoon|evening)|welcome|assalam|salam)")


@dataclass
class _Segment:
    """One sentence to say, and a whiteboard event to publish just before saying it."""

    text: str
    canvas: Optional[dict] = None


class Presenter:
    def __init__(self, service: "FlickService"):
        self.service = service
        self.state: State = "idle"
        self.style = "class"
        self.study = False  # True: a student's study session (no PowerPoint, shown on the Study page)
        self.slide: Optional[int] = None
        self.total = 0
        self.line: Optional[str] = None
        self.message: Optional[str] = None
        #: Why PowerPoint is not following the talk (None when it is).
        self.powerpoint: Optional[str] = None
        #: Token Analyzer card of this talk (every Claude call during it is counted there).
        self.usage_card: Optional[str] = None
        self.paused_for: Optional[Literal["question", "manual"]] = None
        self.canvas_id: Optional[str] = None
        self._deck: Optional[Deck] = None
        self._task: Optional[asyncio.Task] = None
        self._unpaused = asyncio.Event()
        self._unpaused.set()
        self._stopped = False
        self._jump: Optional[int] = None
        self._question_timer: Optional[asyncio.TimerHandle] = None
        self._just_resumed = False

    # ── Status ──────────────────────────────────────────────────────────────

    @property
    def active(self) -> bool:
        return self.state in ("starting", "presenting", "paused")

    @property
    def target(self) -> str:
        """Where the whiteboard shows: the class (floating window) or the Study page."""
        return "study" if self.study else "class"

    def status(self) -> dict:
        return {
            "state": self.state,
            "slide": self.slide,
            "total": self.total,
            "line": self.line,
            "paused_for": self.paused_for,
            "message": self.message,
            "deck": self._deck.name if self._deck else None,
            "deck_id": self._deck.id if self._deck else None,
            "style": self.style,
            "study": self.study,
            "powerpoint": self.powerpoint,
        }

    async def _show_in_powerpoint(self, n: int) -> None:
        """Moves PowerPoint to slide n. If it can't, the talk goes on and the dashboard says why."""
        deck = self._deck
        problem = await self.service.bridge.show_slide(n, deck.file_path if deck else None, deck.name if deck else None)
        if problem != self.powerpoint:
            self.powerpoint = problem
            self._publish()

    def _publish(self) -> None:
        self.service.events.publish("present", self.status())

    # ── Controls ────────────────────────────────────────────────────────────

    def start(self, deck: Deck, from_slide: int = 1, style: str = "class", study: bool = False) -> None:
        if self.active:
            return
        self._deck = deck
        self.style = style
        self.study = study
        self.total = len(deck.slides)
        self.slide = max(1, min(from_slide, self.total))
        self.line = None
        self.message = None
        self.powerpoint = None
        self.paused_for = None
        self._stopped = False
        self._jump = None
        self._unpaused.set()
        self.state = "starting"
        meter = self.service.usage
        self.usage_card = meter.open_card(
            "study" if study else "presentation", deck.name, deck_id=deck.id, deck_name=deck.name, style=style
        )
        self._publish()
        with usage.tagged(kind="talk", card=self.usage_card, deck_id=deck.id, style=style):
            self._task = asyncio.ensure_future(self._run(deck, self.slide))

    def stop(self) -> None:
        if not self.active:
            return
        self._stopped = True
        self.service.usage.close_card(self.usage_card)
        if self._task is not None and not self._task.done():
            self._task.cancel()  # a new talk must never run alongside the old one
        self._cancel_question_timer()
        self._unpaused.set()
        self.service.speaker.stop()  # type: ignore[union-attr]
        self._close_canvas()
        self.state = "idle"
        self.line = None
        self.paused_for = None
        self._publish()

    def pause(self, reason: Literal["question", "manual"] = "manual") -> None:
        """Raise hand: stop talking at once. A question pause continues by itself after the answer."""
        if self.state not in ("presenting", "starting"):
            return
        self.state = "paused"
        self.paused_for = reason
        self._unpaused.clear()
        self.service.speaker.stop()  # type: ignore[union-attr]
        if reason == "question":
            self._cancel_question_timer()
            loop = asyncio.get_running_loop()
            self._question_timer = loop.call_later(QUESTION_WAIT_S, self.resume)
        self._publish()

    def resume(self) -> None:
        if self.state != "paused":
            return
        self._cancel_question_timer()
        self.state = "presenting"
        self.paused_for = None
        self._just_resumed = True
        self._unpaused.set()
        self._publish()

    def go(self, offset: int) -> None:
        """Next (+1) or previous (-1) slide."""
        if not self.active or self.slide is None:
            return
        target = max(1, min(self.total, self.slide + offset))
        self._jump = target
        self.service.speaker.stop()  # type: ignore[union-attr]
        if self.state == "paused":
            self.resume()

    async def question_answered(self) -> None:
        """Called after a question was answered: continue once the answer (and any drawing) was said."""
        if self.state != "paused" or self.paused_for != "question":
            return
        await self.service.wait_until_quiet()
        self.resume()

    def _cancel_question_timer(self) -> None:
        if self._question_timer is not None:
            self._question_timer.cancel()
            self._question_timer = None

    def _close_canvas(self) -> None:
        if self.canvas_id:
            self.service.events.publish("canvas", {"action": "close", "id": self.canvas_id, "target": self.target})
            self.canvas_id = None

    # ── The talk ────────────────────────────────────────────────────────────

    async def _say(self, text: str) -> bool:
        """Says one sentence; returns False if it was cut off (pause / next / stop)."""
        self.line = text
        self._publish()
        return await self.service.speaker.say(text)  # type: ignore[union-attr]

    async def _wait_if_paused(self) -> None:
        await self._unpaused.wait()
        if self._just_resumed and not self._stopped and self._jump is None:
            self._just_resumed = False
            await self._say(CONTINUE)
        self._just_resumed = False

    async def _speak(self, segments: list[_Segment]) -> None:
        """Says the segments in order; after a pause it repeats the sentence that was cut off."""
        i = 0
        while i < len(segments):
            await self._wait_if_paused()
            if self._stopped or self._jump is not None:
                return
            segment = segments[i]
            if segment.canvas is not None:
                if segment.canvas.get("action") == "open":
                    self.canvas_id = segment.canvas["id"]
                self.service.events.publish("canvas", segment.canvas)
            if await self._say(segment.text):
                i += 1

    def _drawing_segments(self, drawing: dict, slide: int) -> list[_Segment]:
        canvas_id = str(uuid.uuid4())
        opened = {"action": "open", "id": canvas_id, "slide": slide, "target": self.target, **drawing}
        segments = [_Segment(DRAW_INTRO.get(self.style, DRAW_INTRO_DEFAULT), opened)]
        for number, step in enumerate(drawing["steps"], start=1):
            event = {"action": "step", "id": canvas_id, "step": number, "say": step["say"], "target": self.target}
            for k, sentence in enumerate(split_sentences(step["say"])):
                segments.append(_Segment(sentence, event if k == 0 else None))
        return segments

    async def _run(self, deck: Deck, start: int) -> None:
        service = self.service
        try:
            n = start
            if not self.study:
                await self._show_in_powerpoint(n)
            self.state = "presenting"
            first = True
            while n <= self.total and not self._stopped:
                if not self.study and self.slide != n:
                    await self._show_in_powerpoint(n)
                self._close_canvas()
                self.slide = n
                usage.set_tag(slide=n)
                self._publish()

                # What to say now; the drawing (if any) is planned meanwhile.
                text, drawing_job = await service.slide_plan(deck, n, self.style)
                service.prefetch_slide_plan(deck, n + 1, self.style)
                sentences = split_sentences(text)
                if first and n == 1 and not _GREETS.match(text.strip().lower()):
                    sentences.insert(0, STUDY_GREETING if self.study else GREETING)
                first = False
                service.speaker.prefetch(sentences, urgent=True)  # type: ignore[union-attr]

                await self._speak([_Segment(s) for s in sentences])
                if not self._stopped and self._jump is None:
                    drawing = await _result(drawing_job, DRAWING_WAIT_S)
                    if drawing:
                        await self._speak(self._drawing_segments(drawing, n))
                if self._stopped:
                    return
                if self._jump is not None:
                    n, self._jump = self._jump, None
                    continue
                n += 1
                if n <= self.total:
                    await asyncio.sleep(SLIDE_GAP_S)
            if not self._stopped:
                await self._wait_if_paused()
                await self._say(STUDY_CLOSING if self.study else CLOSING)
                self.state = "finished"
                self.line = None
                self.service.usage.close_card(self.usage_card)
                self._publish()
        except Exception as err:  # never crash silently mid-talk
            self.state = "error"
            self.message = f"Presenting stopped: {err}"
            self._publish()


async def _result(job: "Optional[asyncio.Future]", timeout: float) -> Optional[dict]:
    """The drawing if it is ready within `timeout`; otherwise skip it and go on with the talk."""
    if job is None:
        return None
    try:
        return await asyncio.wait_for(asyncio.shield(job), timeout)
    except Exception:
        return None
