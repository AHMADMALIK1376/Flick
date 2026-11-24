"""Auto-present: Flick gives the whole talk.

    start → for each slide: show it in PowerPoint → say its explanation, sentence by sentence
          → next slide … → "That's the end. Any questions?"

Raise hand (the Ask hotkey, the mic, or the Pause button) pauses Flick at once. When the
question has been answered it says "Let's continue." and goes on from the sentence it was
saying. Next / Previous / Stop work at any time.

Every change is published as a "present" event, which the answer card and the Presentation
page show (slide, state, and the sentence being said as a caption).
"""

from __future__ import annotations

import asyncio
import re
from typing import TYPE_CHECKING, Literal, Optional

from .models import Deck
from .voice import split_sentences

if TYPE_CHECKING:
    from .service import FlickService

State = Literal["idle", "starting", "presenting", "paused", "finished", "error"]

#: If someone raised a hand but no question arrives, continue after this long.
QUESTION_WAIT_S = 30.0
#: Breath between slides.
SLIDE_GAP_S = 0.6

GREETING = "Hello everyone."
#: The first slide's explanation may already greet the room: then Flick doesn't greet twice.
_GREETS = re.compile(r"^(hello|hi\b|hey\b|good (morning|afternoon|evening)|welcome|assalam|salam)")
CONTINUE = "Now, let's continue."
CLOSING = "That's the end of the presentation. Thank you for listening! Are there any questions?"


class Presenter:
    def __init__(self, service: "FlickService"):
        self.service = service
        self.state: State = "idle"
        self.slide: Optional[int] = None
        self.total = 0
        self.line: Optional[str] = None
        self.message: Optional[str] = None
        self.paused_for: Optional[Literal["question", "manual"]] = None
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

    def status(self) -> dict:
        return {
            "state": self.state,
            "slide": self.slide,
            "total": self.total,
            "line": self.line,
            "paused_for": self.paused_for,
            "message": self.message,
            "deck": self._deck.name if self._deck else None,
        }

    def _publish(self) -> None:
        self.service.events.publish("present", self.status())

    # ── Controls ────────────────────────────────────────────────────────────

    def start(self, deck: Deck, from_slide: int = 1) -> None:
        if self.active:
            return
        self._deck = deck
        self.total = len(deck.slides)
        self.slide = max(1, min(from_slide, self.total))
        self.line = None
        self.message = None
        self.paused_for = None
        self._stopped = False
        self._jump = None
        self._unpaused.set()
        self.state = "starting"
        self._publish()
        self._task = asyncio.ensure_future(self._run(deck, self.slide))

    def stop(self) -> None:
        if not self.active:
            return
        self._stopped = True
        self._cancel_question_timer()
        self._unpaused.set()
        self.service.speaker.stop()  # type: ignore[union-attr]
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
        """Called after a question was answered: continue once the answer has been said."""
        if self.state != "paused" or self.paused_for != "question":
            return
        await self.service.speaker.idle()  # type: ignore[union-attr]
        self.resume()

    def _cancel_question_timer(self) -> None:
        if self._question_timer is not None:
            self._question_timer.cancel()
            self._question_timer = None

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

    async def _run(self, deck: Deck, start: int) -> None:
        service = self.service
        try:
            n = start
            await service.bridge.show_slide(n)
            self.state = "presenting"
            if n == 1 and not _GREETS.match((await service.slide_explanation(deck, 1)).strip().lower()):
                await self._say(GREETING)
            while n <= self.total and not self._stopped:
                if self.slide != n:
                    await service.bridge.show_slide(n)
                self.slide = n
                self._publish()
                text = await service.slide_explanation(deck, n)
                self._prefetch_next(deck, n + 1)
                sentences = split_sentences(text)
                service.speaker.prefetch(sentences, urgent=True)  # type: ignore[union-attr]
                i = 0
                while i < len(sentences) and not self._stopped and self._jump is None:
                    await self._wait_if_paused()
                    if self._stopped or self._jump is not None:
                        break
                    if await self._say(sentences[i]):
                        i += 1
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
                await self._say(CLOSING)
                self.state = "finished"
                self.line = None
                self._publish()
        except Exception as err:  # never crash silently mid-talk
            self.state = "error"
            self.message = f"Presenting stopped: {err}"
            self._publish()

    def _prefetch_next(self, deck: Deck, n: int) -> None:
        if n > self.total:
            return

        async def job() -> None:
            try:
                text = await self.service.slide_explanation(deck, n)
                self.service.speaker.prefetch(split_sentences(text))  # type: ignore[union-attr]
            except Exception:
                pass

        self.service._background(job())
