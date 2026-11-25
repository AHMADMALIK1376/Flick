"""Study sessions (story / professional / exam) and the whiteboard (smart drawings)."""

import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from flick.api import create_app
from flick.lessons import CANVAS_H, CANVAS_W, clean_drawing, parse_drawing, parse_lesson
from flick.text import parse_draw_request

from .conftest import FakeLLM, make_pptx, make_service, make_speaker

DRAWING = {
    "title": "How RLS works",
    "elements": [
        {"id": "u", "type": "emoji", "x": 120, "y": 300, "char": "👩‍🎓", "size": 70, "label": "Sara", "step": 1},
        {"id": "db", "type": "box", "x": 400, "y": 250, "w": 200, "h": 100, "label": "Database", "emoji": "🗄️", "color": "plum", "step": 2},
        {"id": "r", "type": "circle", "x": 820, "y": 300, "r": 60, "label": "Her rows", "color": "aqua", "step": 3},
        {"type": "arrow", "from": "u", "to": "db", "label": "asks", "step": 2},
        {"type": "arrow", "from": "db", "to": "r", "label": "filters", "step": 3},
        {"type": "text", "x": 500, "y": 540, "text": "Only your own rows!", "size": 30, "color": "rose", "step": 3},
    ],
    "steps": [
        {"say": "Here is Sara, a student."},
        {"say": "She asks the database for marks."},
        {"say": "The database gives her only her own rows."},
    ],
}


class ScriptedLLM(FakeLLM):
    """complete() answers by the kind of request: a lesson, a drawing decision, or a drawing on request."""

    def __init__(self, auto_drawing=None, lesson_drawing=None, asked_drawing=DRAWING, **kw):
        super().__init__(**kw)
        self.auto_drawing = auto_drawing
        self.lesson_drawing = lesson_drawing
        self.asked_drawing = asked_drawing
        self.systems = []

    async def complete(self, system, message, max_tokens=700):
        self.systems.append(system)
        if "explaining a presentation out loud, one slide at a time" in system:
            mode = "story" if "STORY MODE" in system else "exam" if "EXAM MODE" in system else "pro"
            return json.dumps({"text": f"In {mode} style. Ali opens his bank app.", "drawing": self.lesson_drawing})
        if "always draw" in system:
            return json.dumps({"drawing": self.asked_drawing})
        if "Plan ONE drawing" in system:
            return json.dumps({"drawing": self.auto_drawing})
        return await super().complete(system, message, max_tokens)


async def load(service, titles=("Intro", "Row level security", "Thanks")):
    return await service.load_deck("/talks/RLS.pptx", data=make_pptx(list(titles)), prepare=False)


async def wait_for(predicate, timeout=6.0):
    loop = asyncio.get_running_loop()
    end = loop.time() + timeout
    while not predicate():
        if loop.time() > end:
            raise AssertionError("timed out")
        await asyncio.sleep(0.01)


def recorder(service):
    events = []
    original = service.events.publish

    def publish(kind, data):
        events.append((kind, data))
        original(kind, data)

    service.events.publish = publish
    return events


# ── Parsing Claude's drawings ───────────────────────────────────────────────


def test_clean_drawing_keeps_good_parts_and_clamps():
    raw = json.loads(json.dumps(DRAWING))
    raw["elements"].append({"type": "arrow", "from": "u", "to": "nobody", "step": 1})  # unknown id: dropped
    raw["elements"].append({"type": "script", "x": 1})  # unknown type: dropped
    raw["elements"][1]["x"] = 5000  # off the board: pulled back in
    drawing = clean_drawing(raw)
    kinds = [e["type"] for e in drawing["elements"]]
    assert kinds.count("arrow") == 2 and "script" not in kinds
    box = next(e for e in drawing["elements"] if e["type"] == "box")
    assert box["x"] + box["w"] <= CANVAS_W and box["y"] + box["h"] <= CANVAS_H
    assert len(drawing["steps"]) == 3


def test_no_drawing_when_claude_says_no():
    assert parse_drawing('{"drawing": null}') is None
    assert parse_drawing("not json") is None
    assert clean_drawing({"elements": [], "steps": [{"say": "x"}]}) is None  # nothing to draw


def test_parse_lesson():
    text, drawing = parse_lesson(json.dumps({"text": "  Ali   opens his app. ", "drawing": DRAWING}))
    assert text == "Ali opens his app." and drawing["title"] == "How RLS works"
    assert parse_lesson("Just plain words.") == ("Just plain words.", None)


@pytest.mark.parametrize(
    "text, kind",
    [
        ("Flick, can you draw this?", "draw"),
        ("give me an example", "example"),
        ("explain this with a story", "story"),
        ("kahani se samjhao", "story"),
        ("What is a story point in agile?", None),
        ("What is normalization?", None),
    ],
)
def test_draw_requests(text, kind):
    assert parse_draw_request(text) == kind


# ── Draw on request ─────────────────────────────────────────────────────────


async def test_draw_on_request_opens_the_whiteboard_and_explains_it(db, tmp_path):
    speaker = make_speaker(tmp_path)
    service = make_service(db, ScriptedLLM(), speaker=speaker)
    await load(service)
    events = recorder(service)

    answer = await service.ask("Flick, can you draw this?")
    assert answer.origin == "example" and answer.voiced
    assert "only her own rows" in answer.answer
    await service.wait_until_quiet()

    canvas = [d for k, d in events if k == "canvas"]
    assert canvas[0]["action"] == "open" and canvas[0]["target"] == "class" and canvas[0]["title"] == "How RLS works"
    assert [c["step"] for c in canvas if c["action"] == "step"] == [1, 2, 3]
    assert speaker.played_texts == [s["say"] for s in DRAWING["steps"]]
    speaker.close()


async def test_story_request_uses_story_style(db, tmp_path):
    llm = ScriptedLLM()
    service = make_service(db, llm, speaker=make_speaker(tmp_path))
    await load(service)
    await service.ask("explain this with a story")
    assert "STORY MODE" in llm.systems[-1]
    service.speaker.close()


async def test_draw_request_falls_back_to_words(db, tmp_path):
    service = make_service(db, ScriptedLLM(asked_drawing=None), speaker=make_speaker(tmp_path))
    await load(service)
    answer = await service.ask("Flick, can you draw this?")
    assert answer.origin != "example"  # answered in words instead
    service.speaker.close()


# ── Presenting with smart drawings ──────────────────────────────────────────


async def test_class_talk_draws_only_where_flick_decides(db, tmp_path):
    speaker = make_speaker(tmp_path)
    llm = ScriptedLLM(auto_drawing=DRAWING)
    service = make_service(db, llm, speaker=speaker)
    deck = await load(service)
    service.db.save_explanations(deck.id, {1: "Welcome.", 2: "RLS filters rows per user.", 3: "Thank you."})
    # Flick decided before: slides 1 and 3 need no drawing.
    service.db.save_drawing(deck.id, 1, "class", None)
    service.db.save_drawing(deck.id, 3, "class", None)
    events = recorder(service)

    service.start_presenting()
    await wait_for(lambda: service.presenter.state == "finished")

    opened = [d for k, d in events if k == "canvas" and d["action"] == "open"]
    assert len(opened) == 1 and opened[0]["slide"] == 2 and opened[0]["target"] == "class"
    said = speaker.played_texts
    assert said.index("RLS filters rows per user.") < said.index("Let me draw this to make it clearer.")
    assert said.index("The database gives her only her own rows.") < said.index("Thank you.")
    assert any(k == "canvas" and d["action"] == "close" for k, d in events)  # put away for the next slide
    speaker.close()


# ── Study sessions ──────────────────────────────────────────────────────────


@pytest.mark.parametrize("style, word", [("story", "story"), ("professional", "pro"), ("exam", "exam")])
async def test_study_session_in_each_style(db, tmp_path, style, word):
    speaker = make_speaker(tmp_path)
    service = make_service(db, ScriptedLLM(lesson_drawing=DRAWING if style == "story" else None), speaker=speaker)
    deck = await load(service)
    events = recorder(service)

    status = service.start_study(style)
    assert status["study"] and status["style"] == style
    await wait_for(lambda: service.presenter.state == "finished")

    assert f"In {word} style." in speaker.played_texts
    assert service.shown_slides == []  # study: PowerPoint is never touched
    assert service.db.get_lesson(deck.id, 2, f"{style}@study")  # lessons are cached (apart from class talks)
    opened = [d for k, d in events if k == "canvas" and d["action"] == "open"]
    assert all(o["target"] == "study" for o in opened)
    assert (len(opened) > 0) == (style == "story")
    speaker.close()


def test_study_api(db, tmp_path):
    service = make_service(db, ScriptedLLM(), speaker=make_speaker(tmp_path))
    h = {"X-Flick-Token": "t"}
    with TestClient(create_app(service, "t")) as c:
        deck_id = c.post("/decks/upload", headers=h, files={"file": ("Talk.pptx", make_pptx(["A", "B"]))}).json()["id"]
        assert {s["id"] for s in c.get("/styles", headers=h).json()} == {"class", "story", "professional", "exam", "visual"}
        r = c.post("/study/start", headers=h, json={"style": "exam", "deck_id": deck_id})
        assert r.status_code == 200 and r.json()["study"] and r.json()["style"] == "exam"
        assert c.post("/present/stop", headers=h).json()["state"] == "idle"
        assert c.post("/study/start", headers=h, json={"deck_id": "nope"}).status_code == 400


def test_visual_mode_always_draws():
    from flick import lessons

    assert lessons.STYLES["visual"] == "Visual mode"
    assert "ALWAYS make the drawing" in lessons.lesson_system("visual")
    assert "ALWAYS make the drawing" not in lessons.lesson_system("story")
    assert "Always draw" in lessons.draw_system("visual", asked=False)
    assert "Decide first" in lessons.draw_system("class", asked=False)


def test_whiteboard_option_inside_every_mode():
    from flick import lessons
    from flick.service import _style

    assert _style("story", "example") == "story+example"
    assert _style("class", "draw") == "class+draw"
    assert _style("exam", "auto") == "exam"
    assert _style("visual", "draw") == "visual"  # visual mode always draws examples anyway
    assert _style("nonsense", "nonsense") == "class"
    assert lessons.split_style("professional+draw") == ("professional", "draw")
    # The mode's own guide stays, plus the board note; and drawing is no longer optional.
    system = lessons.lesson_system("story+example")
    assert "STORY MODE" in system and "daily-life example" in system and "ALWAYS make the drawing" in system
    assert "Always draw" in lessons.draw_system("class+draw", asked=False)
    assert "Decide first" in lessons.draw_system("story", asked=False)


async def test_standard_mode_with_draw_every_slide_asks_for_a_drawing_each_slide(db, tmp_path):
    systems = []

    def reply(system, message):
        systems.append(system)
        return '{"drawing": null}'

    speaker = make_speaker(tmp_path)
    service = make_service(db, FakeLLM(complete_text=reply), speaker=speaker)
    deck = await service.load_deck("/talks/X.pptx", data=make_pptx(["A", "B"]), prepare=False)
    service.db.save_explanations(deck.id, {1: "One.", 2: "Two."})
    status = service.start_presenting(style="class", board="draw")
    assert status["style"] == "class+draw"
    for _ in range(200):
        if service.presenter.state == "finished":
            break
        await asyncio.sleep(0.05)
    draws = [s for s in systems if "Always draw" in s]
    assert len(draws) == 2  # one drawing per slide, the prepared explanations are still used
    speaker.close()


def test_study_api_accepts_visual_mode(db):
    from fastapi.testclient import TestClient

    from flick.api import create_app

    service = make_service(db)
    with TestClient(create_app(service, "t")) as c:
        styles = c.get("/styles", headers={"X-Flick-Token": "t"}).json()
    assert any((s.get("id") if isinstance(s, dict) else s) == "visual" for s in styles)
