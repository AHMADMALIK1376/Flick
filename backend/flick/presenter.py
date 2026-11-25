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
from . import lessons, usage
from .voice import split_sentences

if TYPE_CHECKING:
    from .service import FlickService

State = Literal["idle", "starting", "presenting", "paused", "finished", "error"]

#: If someone raised a hand but no question arrives, continue after this long.
QUESTION_WAIT_S = 75.0  # speak, read it back, edit, press ✓
#: Breath between slides.
SLIDE_GAP_S = 0.6
#: After a slide was explained, how long to wait (silently) for a drawing that may come. Short: a
#: drawing that isn't ready by then is skipped rather than leaving the room in silence.
DRAWING_WAIT_S = 2.5
#: In "draw every slide" talks the drawing always comes: Flick says it is sketching, then waits this long.
PROMISED_DRAWING_WAIT_S = 12.0

# What Flick says between slides. Lines that come up more than once in a talk rotate, so Flick
# never sounds like a recording ("Now, let's continue." five times in a row is what robots do).
GREETING = "Hi everyone! Thanks for being here."
STUDY_GREETING = "Hey! Let's go through this together, one step at a time."
CONTINUES = [
    "Okay, let's pick up where we left off.",
    "Alright, back to where we were.",
    "Good. Let's keep going.",
    "Right, so, where were we? Let's carry on.",
]
CONTINUE = CONTINUES[0]
CLOSING = "And that's everything from me today. Thank you so much for listening! Any questions? I'm happy to help."
STUDY_CLOSING = "And that's the whole thing. Nice work sticking with it! Anything you'd like me to go over again?"
DRAW_INTROS = {
    "story": [
        "Let me draw this part of the story.",
        "Picture this. Let me sketch it.",
        "Here, let me show you what happened.",
    ],
    "exam": [
        "Let me draw this, it's easier to remember as a picture.",
        "Quick sketch, this is the picture to keep in your head.",
    ],
}
DRAW_INTROS_DEFAULT = [
    "Let me draw this to make it clearer.",
    "Actually, this is easier to see. Let me sketch it.",
    "Let me show you on the board.",
    "Okay, let me draw this out.",
]
DRAW_INTRO_DEFAULT = DRAW_INTROS_DEFAULT[0]

# The same lines in Urdu, and in Urdu + English the way Pakistani teachers mix them. Written with
# "we" forms (چلیں، دیکھتے ہیں) so they fit both a woman's and a man's voice.
LINES: dict[str, dict[str, object]] = {
    "ur": {
        "greeting": "السلام علیکم سب کو! آپ سب کا بہت شکریہ کہ آپ یہاں ہیں۔",
        "study_greeting": "السلام علیکم! چلیں، یہ سب مل کر آرام سے، ایک ایک قدم سمجھتے ہیں۔",
        "continue": [
            "اچھا، تو وہیں سے شروع کرتے ہیں جہاں رکے تھے۔",
            "ٹھیک ہے، واپس آتے ہیں اپنی بات پر۔",
            "چلیں، آگے چلتے ہیں۔",
            "ہاں تو، ہم کہاں تھے؟ چلیں، آگے بڑھتے ہیں۔",
        ],
        "closing": "تو آج کے لیے بس اتنا ہی۔ سننے کا بہت بہت شکریہ! کوئی سوال ہو تو ضرور پوچھیں۔",
        "study_closing": "اور یہ تھا پورا سبق۔ بہت خوب، آپ نے آخر تک ساتھ دیا! کچھ دوبارہ سمجھنا ہو تو ضرور بتائیں۔",
        "draw": ["چلیں، اسے بورڈ پر بنا کر دیکھتے ہیں۔", "یہ تصویر سے زیادہ آسانی سے سمجھ آئے گا، دیکھیں۔", "ایک منٹ، اسے بورڈ پر سمجھتے ہیں۔"],
        "draw_story": ["چلیں، کہانی کا یہ حصہ بورڈ پر دیکھتے ہیں۔", "ذرا تصور کریں، اسے بنا کر دیکھتے ہیں۔"],
        "asked_draw": "چلیں، اسے بورڈ پر بنا کر دیکھتے ہیں۔",
        "asked_example": "چلیں، روزمرہ زندگی کی ایک مثال بورڈ پر بنا کر دیکھتے ہیں۔",
        "again_same": "جی ضرور، اسے ایک اور طریقے سے دوبارہ سمجھتے ہیں۔",
        "again_back": "جی ضرور۔ چلیں، واپس سلائیڈ {n} پر چلتے ہیں۔",
        "again_ahead": "جی ضرور۔ چلیں، سلائیڈ {n} دیکھتے ہیں۔",
        "return": "ٹھیک ہے! اب واپس سلائیڈ {n} پر، جہاں ہم تھے۔",
    },
    "mix": {
        "greeting": "Hello everyone! آپ سب کا بہت شکریہ کہ آپ یہاں ہیں۔",
        "study_greeting": "Hey! چلیں، یہ topic مل کر step by step سمجھتے ہیں۔",
        "continue": [
            "Okay، تو وہیں سے continue کرتے ہیں جہاں رکے تھے۔",
            "Alright، واپس اپنے topic پر آتے ہیں۔",
            "Good، آگے چلتے ہیں۔",
            "ہاں تو، ہم کہاں تھے؟ چلیں continue کرتے ہیں۔",
        ],
        "closing": "تو آج کے لیے بس اتنا ہی۔ Thank you so much سننے کے لیے! کوئی بھی question ہو تو ضرور پوچھیں۔",
        "study_closing": "اور یہ تھا پورا topic۔ Well done، آپ نے end تک ساتھ دیا! کچھ بھی دوبارہ سمجھنا ہو تو بتائیں۔",
        "draw": ["چلیں، اسے board پر draw کر کے دیکھتے ہیں۔", "یہ picture سے زیادہ easily سمجھ آئے گا، دیکھیں۔", "ایک minute، اسے quickly sketch کرتے ہیں۔"],
        "draw_story": ["چلیں، story کا یہ part board پر دیکھتے ہیں۔", "Imagine کریں، اسے sketch کرتے ہیں۔"],
        "asked_draw": "چلیں، اسے board پر draw کرتے ہیں۔",
        "asked_example": "چلیں، ایک real-life example board پر بنا کر دیکھتے ہیں۔",
        "again_same": "Sure، اسے ایک different way سے دوبارہ سمجھتے ہیں۔",
        "again_back": "Sure! چلیں واپس slide {n} پر چلتے ہیں۔",
        "again_ahead": "Sure! چلیں slide {n} دیکھتے ہیں۔",
        "return": "Okay! اب واپس slide {n} پر، جہاں ہم تھے۔",
    },
}
_ENGLISH = {
    "greeting": GREETING,
    "study_greeting": STUDY_GREETING,
    "continue": CONTINUES,
    "closing": CLOSING,
    "study_closing": STUDY_CLOSING,
    "draw": DRAW_INTROS_DEFAULT,
    "draw_story": DRAW_INTROS["story"],
    "draw_exam": DRAW_INTROS["exam"],
    "asked_draw": "Let me draw it for you.",
    "asked_example": "Let me draw a real-life example.",
    "again_same": "Sure, let me go over that again, a different way.",
    "again_back": "Sure. Let's go back to slide {n}.",
    "again_ahead": "Sure. Let's look at slide {n}.",
    "return": "Okay! Now, back to slide {n}, where we were.",
}
#: A new explanation for "explain slide 6 again": worth a short wait (the intro covers most of it).
FRESH_WAIT_S = 15.0
#: A drawing someone asked for ("go back to slide 6 and draw it"): worth waiting longer for.
ASKED_DRAWING_WAIT_S = 30.0
ASKED_DRAW_INTRO = {"example": "Let me draw a real-life example.", "draw": "Let me draw it for you."}
#: The first slide's text may already greet the room: then Flick doesn't greet twice.
_GREETS = re.compile(r"^(hello|hi\b|hey\b|good (morning|afternoon|evening)|welcome|assalam|salam|السلام|اسلام|آداب|خوش آمدید)")


@dataclass
class _Detour:
    """ "Go back to slide 6 and explain it again": explain `slide`, then return to `back`."""

    slide: int
    back: Optional[int]
    board: str = "auto"  # auto | draw | example
    request: Optional[str] = None
    started: bool = False


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
        self._detour: Optional[_Detour] = None
        self._said_count: dict[str, int] = {}
        self.language = "en"  # the talk's language (set when it starts)  # rotating lines: how often each kind was said this talk
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

    @property
    def plan_key(self) -> str:
        """What Flick says is written for the audience (a class or one student) and in the talk's language."""
        return lessons.plan_key(self.style, self.study, self.language)

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
        self._detour = None
        self._said_count = {}
        self.language = self.service.talk_language()[0]  # fixed for the whole talk
        self._prevoice_own_lines()
        self._unpaused.set()
        self.state = "starting"
        meter = self.service.usage
        self.usage_card = meter.open_card(
            "study" if study else "presentation", deck.name, deck_id=deck.id, deck_name=deck.name,
            style=style + (f"#{self.language}" if self.language != "en" else ""),
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

    def jump_to(self, slide: int) -> None:
        """ "Go to slide 6": carry on the talk from there."""
        if not self.active:
            return
        self._detour = None
        self._jump = max(1, min(self.total, slide))
        self.service.speaker.stop()  # type: ignore[union-attr]
        if self.state == "paused":
            self.resume()

    def revisit(self, slide: int, board: str = "auto", request: Optional[str] = None) -> Optional[int]:
        """ "Go back to slide 6 and explain it again (and draw it)": explain that slide, then come
        back to the slide Flick was on and carry on. → the slide it will come back to."""
        if not self.active:
            return None
        slide = max(1, min(self.total, slide))
        back = self._detour.back if self._detour else self.slide  # a detour within a detour returns home
        self._detour = _Detour(slide, back, board, request)
        self._jump = slide
        self.service.speaker.stop()  # type: ignore[union-attr]
        if self.state == "paused":
            self.resume()
        return back

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
            await self._say(self._line("continue"))
        self._just_resumed = False

    async def _speak(self, segments: list[_Segment]) -> None:
        """Says the segments in order; after a pause it repeats the sentence that was cut off."""
        if len(segments) > 1:  # make the audio for all of them now, so they follow without gaps
            self.service.speaker.prefetch([seg.text for seg in segments if seg.text], urgent=True)  # type: ignore[union-attr]
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
            if not segment.text or await self._say(segment.text):
                i += 1

    def _prevoice_own_lines(self) -> None:
        """Flick's own short lines (greeting, carrying on, drawing intros, closing) are made once and
        kept on disk; doing it at the start means none of them ever waits to be made."""
        speaker = self.service.speaker
        if speaker is None or not self.service._natural_voice():
            return
        lines = LINES.get(self.language) or _ENGLISH
        texts: list[str] = []
        for value in lines.values():
            for line in value if isinstance(value, list) else [value]:
                if "{" not in str(line):
                    texts.append(str(line))
        speaker.prefetch(texts)

    def _line(self, kind: str, **values) -> str:
        """One of Flick's own lines, in the talk's language. Lists rotate; {n} is filled in."""
        lines = LINES.get(self.language, {}).get(kind) or _ENGLISH.get(kind) or ""
        line = self._rotate(kind, lines) if isinstance(lines, list) else str(lines)
        return line.format(**values) if values else line

    def _rotate(self, kind: str, lines: list[str]) -> str:
        """The next line of this kind: first time the first one, then the others in turn."""
        n = self._said_count.get(kind, 0)
        self._said_count[kind] = n + 1
        return lines[n % len(lines)]

    def draw_intro_lines(self) -> list[str]:
        """Every way this talk may introduce a drawing (they rotate), so the next one is ready."""
        lines = LINES.get(self.language, {}).get(self._draw_kind()) or _ENGLISH.get(self._draw_kind()) or []
        return [str(line) for line in (lines if isinstance(lines, list) else [lines])]

    def _draw_kind(self) -> str:
        base = lessons.base_style(self.style)
        return f"draw_{base}" if f"draw_{base}" in _ENGLISH else "draw"

    def _drawing_segments(self, drawing: dict, slide: int, intro: bool = True) -> list[_Segment]:
        canvas_id = str(uuid.uuid4())
        opened = {"action": "open", "id": canvas_id, "slide": slide, "target": self.target, **drawing}
        segments = [_Segment(self._line(self._draw_kind()) if intro else "", opened)]
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

                detour = self._detour if self._detour and self._detour.slide == n and not self._detour.started else None
                fresh = None
                if detour:
                    detour.started = True
                    # Explained again: in new words (written while Flick says "Sure, let's go back...").
                    fresh = service.fresh_explanation(deck, n, self.plan_key, detour.request)
                    if detour.board != "auto":  # start drawing now, while the slide is explained
                        asked = service.requested_drawing(deck, n, self.plan_key, detour.board, detour.request)
                    if detour.back == n:
                        intro = self._line("again_same")
                    elif detour.back and detour.back > n:
                        intro = self._line("again_back", n=n)
                    else:
                        intro = self._line("again_ahead", n=n)
                    await self._speak([_Segment(intro)])
                    if self._stopped or self._jump is not None:
                        if self._stopped:
                            return
                        n, self._jump = self._jump, None
                        continue

                # What to say now; the drawing (if any) is planned meanwhile.
                text, drawing_job = await service.slide_plan(deck, n, self.plan_key)
                if fresh is not None:
                    text = await _text_result(fresh, FRESH_WAIT_S) or text
                if detour and detour.board != "auto":
                    drawing_job = asked
                service.prefetch_slide_plan(deck, n + 1, self.plan_key)
                sentences = split_sentences(text)
                if first and n == 1 and not _GREETS.match(text.strip().lower()):
                    sentences.insert(0, self._line("study_greeting" if self.study else "greeting"))
                first = False
                service.speaker.prefetch(sentences, urgent=True)  # type: ignore[union-attr]

                await self._speak([_Segment(s) for s in sentences])
                if not self._stopped and self._jump is None:
                    if detour and detour.board != "auto":
                        await self._speak([_Segment(self._line(f"asked_{detour.board}"))])
                        drawing = await _result(drawing_job, ASKED_DRAWING_WAIT_S)
                        if drawing:
                            await self._speak(self._drawing_segments(drawing, n, intro=False))
                    elif drawing_job is not None and not drawing_job.done() and lessons.always_draws(self.style):
                        # Still being planned, but promised: say so instead of going quiet.
                        await self._speak([_Segment(self._line(self._draw_kind()))])
                        drawing = await _result(drawing_job, PROMISED_DRAWING_WAIT_S)
                        if drawing:
                            await self._speak(self._drawing_segments(drawing, n, intro=False))
                    else:
                        drawing = await _result(drawing_job, DRAWING_WAIT_S)
                        if drawing:
                            await self._speak(self._drawing_segments(drawing, n))
                if self._stopped:
                    return
                if self._jump is not None:
                    n, self._jump = self._jump, None
                    continue
                if detour and self._detour is detour:
                    # Done with the slide they asked for: back to where the talk was.
                    self._detour = None
                    if detour.back and detour.back != n:
                        self._close_canvas()
                        await self._speak([_Segment(self._line("return", n=detour.back))])
                        if self._stopped:
                            return
                        if self._jump is not None:
                            n, self._jump = self._jump, None
                        else:
                            n = detour.back
                        continue
                n += 1
                if n <= self.total:
                    await asyncio.sleep(SLIDE_GAP_S)
            if not self._stopped:
                await self._wait_if_paused()
                await self._say(self._line("study_closing" if self.study else "closing"))
                self.state = "finished"
                self.line = None
                self.service.usage.close_card(self.usage_card)
                self._publish()
        except Exception as err:  # never crash silently mid-talk
            self.state = "error"
            self.message = f"Presenting stopped: {err}"
            self._publish()


async def _text_result(job: "asyncio.Future", timeout: float) -> Optional[str]:
    try:
        text = await asyncio.wait_for(asyncio.shield(job), timeout)
    except Exception:
        return None
    return text.strip() or None if isinstance(text, str) else None


async def _result(job: "Optional[asyncio.Future]", timeout: float) -> Optional[dict]:
    """The drawing if it is ready within `timeout`; otherwise skip it and go on with the talk."""
    if job is None:
        return None
    try:
        return await asyncio.wait_for(asyncio.shield(job), timeout)
    except Exception:
        return None
