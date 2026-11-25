import io
from typing import Optional

import pytest
from pptx import Presentation
from pptx.util import Inches

from flick.db import Database
from flick.events import EventBus
import re

import numpy as np

from flick.llm import LLMError, SearchResult, SentenceStream
from flick.prompts import message_text
from flick.powerpoint import PowerPointBridge
from flick.service import FlickService


class FakeLLM:
    """Records calls (as plain text); answers from a script. `fail` raises that error kind instead.
    Every successful call is counted by the Token Analyzer as 1000 input + 100 output tokens."""

    meter = None  # set by FlickService

    def _count(self, searches: int = 0):
        if self.meter is not None:
            usage = {"input_tokens": 1000, "output_tokens": 100}
            if searches:
                usage["server_tool_use"] = {"web_search_requests": searches}
            self.meter.record("claude-haiku-5-5", usage)

    def __init__(self, complete_text="TEXT", search: Optional[SearchResult] = None, fail: Optional[str] = None):
        self.complete_text = complete_text
        self.search = search or SearchResult("LIVE.", [], False)
        self.fail = fail
        self.complete_calls: list[tuple[str, str]] = []
        self.search_calls: list[tuple[str, str]] = []
        self.raw_search_messages: list = []

    def _text(self, system, message):
        return self.complete_text(system, message_text(message)) if callable(self.complete_text) else self.complete_text

    async def complete(self, system, message, max_tokens=700):
        self.complete_calls.append((system, message_text(message)))
        if self.fail:
            raise LLMError(self.fail, "boom")
        self._count()
        return self._text(system, message)

    async def check_key(self):
        if self.fail:
            raise LLMError(self.fail, "boom")

    async def search_complete(self, system, message, max_tokens=700, max_searches=3):
        self.search_calls.append((system, message_text(message)))
        self.raw_search_messages.append(message)
        if self.fail:
            raise LLMError(self.fail, "boom")
        self._count(searches=1 if self.search.searched else 0)
        return self.search

    async def stream_complete(self, system, message, max_tokens, on_text):
        text = await self.complete(system, message, max_tokens)
        stream = SentenceStream(on_text)
        await stream.feed(text)
        await stream.flush()
        return text

    async def stream_search(self, system, message, max_tokens, max_searches, on_text, on_search):
        result = await self.search_complete(system, message, max_tokens, max_searches)
        if result.searched:
            await on_search()
        stream = SentenceStream(on_text)
        await stream.feed(result.text)
        await stream.flush()
        return result


class FakeEmbedder:
    """Meaning vectors from a small dictionary of 'topics', so tests are exact."""

    name = "fake-embedder"
    TOPICS = ["rls", "explain", "synthetic", "speed", "secure", "keyword"]
    SYNONYMS = {"row level security": "rls", "row-level security": "rls", "rls": "rls", "explain": "explain",
                "cost check": "explain", "fake data": "synthetic", "synthetic": "synthetic", "slow": "speed",
                "faster": "speed", "secure": "secure", "safe": "secure", "keyword": "keyword", "delete": "keyword"}

    def __init__(self, ready=True):
        self._ready = ready
        self.calls = 0

    def ready(self):
        return self._ready

    def embed(self, texts):
        self.calls += 1
        out = []
        for t in texts:
            v = np.zeros(len(self.TOPICS), dtype=np.float32)
            for phrase, topic in self.SYNONYMS.items():
                if phrase in t.lower():
                    v[self.TOPICS.index(topic)] = 1
            norm = np.linalg.norm(v)
            out.append(v / norm if norm else v)
        return np.array(out, dtype=np.float32)


class FakeTranscriber:
    def __init__(self, text="Flick, what is row level security?"):
        self.text = text
        self.calls = []
        self.error = None

    def ready(self, size):
        return True

    def load(self, size):
        pass

    def transcribe(self, audio, size, language, hint=""):
        self.calls.append((audio, size, language, hint))
        return self.text, 420


def make_pptx(titles: list[str], reorder_last_to: Optional[int] = None) -> bytes:
    """A real .pptx made with python-pptx: title + bullets + notes per slide, a table on slide 2."""
    prs = Presentation()
    for i, title in enumerate(titles, start=1):
        slide = prs.slides.add_slide(prs.slide_layouts[1])
        slide.shapes.title.text = title
        body = slide.placeholders[1].text_frame
        body.text = f"Point A about {title}"
        body.add_paragraph().text = f"Point B & more"
        slide.notes_slide.notes_text_frame.text = f"Notes for {title}"
        if i == 2:
            table = slide.shapes.add_table(2, 2, Inches(1), Inches(4), Inches(4), Inches(1)).table
            table.cell(0, 0).text, table.cell(0, 1).text = "Model", "Accuracy"
            table.cell(1, 0).text, table.cell(1, 1).text = "CNN", "94%"
    if reorder_last_to is not None:
        ids = prs.slides._sldIdLst
        last = ids[-1]
        ids.remove(last)
        ids.insert(reorder_last_to, last)
    buf = io.BytesIO()
    prs.save(buf)
    return buf.getvalue()


@pytest.fixture
def db():
    d = Database(":memory:")
    yield d
    d.close()


def make_service(
    db, llm=None, slide_answer: Optional[str] = "", platform="win32", embedder=None, transcriber=None, speaker=None
):
    calls = []
    shown = []

    def query(kind):
        calls.append(kind)
        return slide_answer if kind == "slide" else None

    def show(number, path=None, name=None):
        shown.append(number)
        return True

    bridge = PowerPointBridge(query=query, platform=platform, show=show)
    service = FlickService(
        db, llm or FakeLLM(), bridge, EventBus(), embedder=embedder, transcriber=transcriber, speaker=speaker
    )
    service.query_calls = calls
    service.shown_slides = shown
    return service


class FakeVoice:
    """Makes 'audio' instantly: 20 ms of silence per word, so tests run fast but timing is real."""

    def __init__(self, ready=True, error=None):
        self._ready = ready
        self.error = error
        self.downloading = False
        self.spoken: list[str] = []  # every text synthesized

    def ready(self):
        return self._ready

    def load(self):
        self._ready = True

    def synthesize(self, text, voice, speed):
        import numpy as np

        self.spoken.append(text)
        return np.zeros(int(24000 * 0.02 * max(1, len(text.split()))), dtype=np.float32), 24000


class RecordingPlayer:
    """Remembers what was played (by file), instead of making sound."""

    def __init__(self):
        self.played = []

    def start(self, wav):
        self.played.append(wav)

    def stop(self):
        pass


def make_speaker(tmp_path, voice=None):
    from flick.voice import Speaker

    player = RecordingPlayer()
    speaker = Speaker(voice or FakeVoice(), cache_dir=tmp_path / "voice", settings=lambda: ("af_heart", 1.0), player=player)
    speaker.played_texts = []  # filled by the wrapper below

    original_say = speaker.say

    def say(text):
        speaker.played_texts.append(text)
        return original_say(text)

    speaker.say = say
    return speaker
