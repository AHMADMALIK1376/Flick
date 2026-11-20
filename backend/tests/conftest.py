import io
from typing import Optional

import pytest
from pptx import Presentation
from pptx.util import Inches

from flick.db import Database
from flick.events import EventBus
from flick.llm import LLMError, SearchResult
from flick.powerpoint import PowerPointBridge
from flick.service import FlickService


class FakeLLM:
    """Records calls; answers from a script. `fail` raises that error kind instead."""

    def __init__(self, complete_text: str = "TEXT", search: Optional[SearchResult] = None, fail: Optional[str] = None):
        self.complete_text = complete_text
        self.search = search or SearchResult("LIVE", [], False)
        self.fail = fail
        self.complete_calls: list[tuple[str, str]] = []
        self.search_calls: list[tuple[str, str]] = []

    async def complete(self, system, message, max_tokens=700):
        self.complete_calls.append((system, message))
        if self.fail:
            raise LLMError(self.fail, "boom")
        return self.complete_text(system, message) if callable(self.complete_text) else self.complete_text

    async def search_complete(self, system, message, max_tokens=700, max_searches=3):
        self.search_calls.append((system, message))
        if self.fail:
            raise LLMError(self.fail, "boom")
        return self.search


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


def make_service(db, llm=None, slide_answer: Optional[str] = "", platform="win32"):
    calls = []

    def query(kind):
        calls.append(kind)
        return slide_answer if kind == "slide" else None

    bridge = PowerPointBridge(query=query, platform=platform)
    service = FlickService(db, llm or FakeLLM(), bridge, EventBus())
    service.query_calls = calls
    return service
