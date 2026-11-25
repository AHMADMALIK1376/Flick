"""Explaining styles and the whiteboard ("canvas").

Styles
  class         the normal talk ("Present for me"), from the explanations prepared before the talk
  story         one continuing story with everyday characters, slide by slide
  professional  precise and concise, with a real industry example
  exam          key points, a memory trick, and a likely exam question with a short model answer

The whiteboard
  Claude decides per slide whether a drawing would really help (complex or abstract ideas,
  processes, relationships, comparisons) and, if so, plans a small hand-drawn picture: boxes,
  circles, emoji characters, arrows and short labels, revealed step by step while Flick talks.
  Asked directly ("draw this", "give me an example", "explain with a story"), it always draws.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal, Optional

from .models import Deck, Slide
from .prompts import AUDIENCE_CLASS, AUDIENCE_STUDY, TEACHER_VOICE, format_slide

Style = Literal["class", "story", "professional", "exam", "visual"]
STYLES: dict[str, str] = {
    "class": "Standard",
    "story": "Story mode",
    "professional": "Professional mode",
    "exam": "Exam mode",
    "visual": "Visual mode",
}

#: Size of the whiteboard. Claude places things on this grid; the screen scales it.
CANVAS_W, CANVAS_H = 1000, 600
COLORS = ("plum", "aqua", "amber", "rose", "green", "gray")
MAX_ELEMENTS = 22
MAX_STEPS = 8

LESSON_MAX_TOKENS = 3200
DRAW_MAX_TOKENS = 2600

# ── Prompts ─────────────────────────────────────────────────────────────────

_STYLE_GUIDE = {
    "story": """STORY MODE. Teach through one continuing story, told the way a good storyteller talks, not read.
Use the same small cast across the whole deck (e.g. Ali and Sara, two university students in Lahore, their
teacher Ms. Ayesha, a chai dhaba, a cricket match, a family business). Each slide is the next scene: show a
moment with a little tension ("Ali is sure his marks are private... until Sara sees them on her screen"),
let the scene make the idea obvious, then step out of the story and say plainly what the idea is.
Warm and vivid, never childish.""",
    "professional": """PROFESSIONAL MODE. Like a senior engineer explaining to a sharp new colleague over coffee:
precise, but still a person talking. Use the correct technical terms (and say what each means in a few words),
give one real-world industry example (a bank, an app, a hospital, a company like Daraz or Careem), and mention
the mistake people commonly make with it ("the classic mistake here is...").""",
    "exam": """EXAM MODE. Like a senior who topped this course helping a friend the night before the exam:
focused, quick, encouraging. Say the two or three points that actually get marks ("First... second..."),
any definition they must know word-for-word ("write this exactly:"), one memory trick that's easy to picture,
and end with "A likely exam question:" plus the question and a short model answer. Skip anything that would
not get marks.""",
    "visual": """VISUAL MODE. The whole presentation is explained through examples drawn on the whiteboard. For every
slide, pick ONE concrete daily-life example that makes the idea obvious (a chai dhaba, a cricket team, a bank
queue, a WhatsApp group, a university canteen, a rickshaw ride) and draw it. The drawing does the teaching:
its steps carry the explanation. What you say before the drawing is only a short lead-in (1-2 sentences,
25-45 words) that names the idea and the example, e.g. "Encryption is like passing a note in a secret code.
Let me draw it." The last step names the idea in one plain sentence.""",
}

LESSON_SYSTEM = """You are Flick, explaining a presentation out loud, one slide at a time. You are given the slide,
the slides around it and (if any) what you said for the previous slide. Write what Flick SAYS for this slide,
in the requested style.

{voice}

{audience}

{style_guide}

Rules:
- About 70-130 words (under a minute of speech); shorter for a simple slide. Spoken English that Pakistani
  students find natural (a Roman Urdu word is fine if the deck uses them).
- Slide 1: open warmly in your own words, with a reason to care about the topic. After slide 1 never greet again;
  continue from what you said last time, with a fresh link each time (never the same one twice in a row).
- Use only what the slide supports plus well-known general knowledge. If the slide is only a title, agenda or
  thank-you slide, say one or two short natural sentences and move on.

{draw_when}

Reply with ONLY this JSON:
{{"text": "...", "drawing": <drawing object or null>}}

{draw_rules}"""

DRAW_RULES = f"""Drawing rules (the whiteboard is {CANVAS_W} x {CANVAS_H}, origin top-left):
- Draw ONLY when the idea is complex or abstract: a process or flow, how parts relate, a comparison,
  cause and effect, a structure, something that is hard to picture. Do NOT draw for a title, agenda,
  summary, thank-you slide, or a simple list. When in doubt, don't draw (use null).
- A drawing is a clear, lively scene, like a good teacher sketching on a whiteboard: 8-18 elements.
  Make it CONCRETE: real people and things as emoji (👩‍🎓 🧑‍🍳 🏦 📱 🍵 🛺 🏏) with short labels, not just
  boxes with words. Use boxes and circles for the parts of a system, arrows (with a verb label: "sends",
  "asks", "pays") for what moves between them, and a few small text notes for key numbers or rules.
- Element types:
  {{"id":"a","type":"box","x":120,"y":220,"w":200,"h":90,"label":"Database","emoji":"🗄️","color":"plum","step":1}}
  {{"id":"b","type":"circle","x":600,"y":260,"r":60,"label":"User","emoji":"🙂","color":"aqua","step":2}}
  {{"id":"c","type":"emoji","x":820,"y":120,"char":"👩‍🏫","size":70,"label":"Teacher","step":2}}
  {{"type":"arrow","from":"a","to":"b","label":"sends data","step":3}}  (from/to are element ids)
  {{"type":"text","x":500,"y":560,"text":"Only your own rows!","size":30,"color":"rose","step":4}}
  box x,y = top-left corner; circle and emoji x,y = centre; text x,y = centre of the text.
- Colours: {", ".join(COLORS)} (use 2-4 of them, the same colour for things of the same kind).
  Labels: at most 4 words. Keep everything 40px inside the edges, leave at least 60px between shapes,
  no overlaps. Use the whole board: spread the scene left to right (or top to bottom) in the order
  things happen; a title row is not needed (the title is shown above the board).
- "steps": 4-7 steps. Step 1 sets the scene, each next step adds the next part (every element has the
  step number when it appears). Each step has "say": 1-2 short spoken sentences, said like a teacher
  sketching on the board while talking: "Okay, so here's Ali, standing at the bank counter." / "Now watch
  what happens when he asks for Sara's balance..." / "See this arrow? That's the request going in."
  Never describe the drawing mechanically ("A box labelled X appears"). The LAST step adds one text element
  at the bottom (y about 550) with the takeaway in a few words, and its "say" lands the idea plainly.
  In story style the drawing shows the story's scene.
- Drawing object: {{"title":"Short title","elements":[...],"steps":[{{"say":"..."}}, ...]}}"""

DRAW_SYSTEM = """You are Flick, a teacher with a whiteboard, the kind students remember because the drawings
make things click. Plan ONE drawing that explains an idea from a presentation slide, in the requested style.
The drawing is revealed step by step while Flick talks through each step, like sketching live in class.

{style_guide}

{draw_rules}

{when}

Reply with ONLY the JSON: {{"drawing": <drawing object or null>}}"""

_WHEN_AUTO = """Decide first whether a drawing would really help this slide. If not, reply {"drawing": null}."""
_WHEN_ASKED = """Someone ASKED for this ("draw it", "give an example", "explain with a story"): always draw.
Answer their request: if they asked about something specific, draw that. If they asked for an example or a story,
the drawing is a concrete daily-life example or a short story scene."""

_WHEN_VISUAL = """Always draw (this talk draws every slide, see the whiteboard note above), unless the slide is
only a title, agenda or thank-you slide (then reply {"drawing": null})."""

_CLASS_GUIDE = """STANDARD STYLE. Clear and friendly, like a good teacher explaining to the class, with a simple
everyday example."""


#: The whiteboard option inside every mode. A style can carry it: "story+example", "class+draw".
BOARDS: dict[str, str] = {
    "auto": "Only when it helps",
    "draw": "Draw every slide",
    "example": "Example on every slide",
}
_BOARD_GUIDE = {
    "draw": """WHITEBOARD: draw on EVERY content slide: a clear picture of the slide's idea (how the parts
connect, the steps of a process, a comparison side by side), in this style.""",
    "example": """WHITEBOARD: on EVERY content slide, draw ONE concrete daily-life example that makes the idea
obvious (a chai dhaba, a cricket team, a bank queue, a WhatsApp group, a university canteen), in this style.""",
}


def split_style(style: str) -> tuple[str, str]:
    """ "story+example" → ("story", "example"); "exam" → ("exam", "auto"). Visual mode always draws examples."""
    base, _, board = (style or "class").split("@")[0].partition("+")
    base = base if base in STYLES else "class"
    if base == "visual":
        return base, "example"
    return base, board if board in _BOARD_GUIDE else "auto"


def is_study(plan_key: str) -> bool:
    """Plans for a study session (one student) are written and saved apart from class talks: "story+draw@study"."""
    return (plan_key or "").endswith("@study")


def base_style(style: str) -> str:
    return split_style(style)[0]


def make_style(base: Optional[str], board: Optional[str] = None) -> str:
    """The style key used for caching and prompts: "story", "story+draw", "class+example"..."""
    base = base if base in STYLES else "class"
    if base == "visual" or board not in _BOARD_GUIDE:
        return base
    return f"{base}+{board}"


def always_draws(style: str) -> bool:
    return split_style(style)[1] != "auto"


def style_guide(style: str) -> str:
    base, board = split_style(style)
    guide = _STYLE_GUIDE.get(base, _CLASS_GUIDE)
    if base != "visual" and board in _BOARD_GUIDE:
        guide += "\n\n" + _BOARD_GUIDE[board]
    return guide


_LESSON_DRAW_WHEN = "Then decide whether a whiteboard drawing would REALLY help this slide (see the drawing rules)."
_LESSON_DRAW_VISUAL = """Then ALWAYS make the drawing, except for a pure title, agenda or thank-you slide (drawing null).
The "Draw ONLY when..." rule below does not apply here: every content slide gets its drawing.
In visual mode "text" is only the short lead-in (25-45 words); in other styles keep the style's length."""


def lesson_system(style: str, study: bool = True) -> str:
    """study: one student on the Study page (a friend explaining); else the whole class (a teacher)."""
    when = _LESSON_DRAW_VISUAL if always_draws(style) else _LESSON_DRAW_WHEN
    return LESSON_SYSTEM.format(
        voice=TEACHER_VOICE,
        audience=AUDIENCE_STUDY if study else AUDIENCE_CLASS,
        style_guide=style_guide(style),
        draw_rules=DRAW_RULES,
        draw_when=when,
    )


def draw_system(style: str, asked: bool) -> str:
    when = _WHEN_ASKED if asked else _WHEN_VISUAL if always_draws(style) else _WHEN_AUTO
    return DRAW_SYSTEM.format(style_guide=style_guide(style), draw_rules=DRAW_RULES, when=when)


def lesson_message(deck: Deck, number: int, previous_text: Optional[str]) -> str:
    by = {s.number: s for s in deck.slides}
    slide = by[number]
    parts = [f"Presentation: {deck.name} ({len(deck.slides)} slides)"]
    if by.get(number - 1):
        parts.append(f"(Context) previous slide {number - 1}: {by[number - 1].title or '(untitled)'}")
    if by.get(number + 1):
        parts.append(f"(Context) next slide {number + 1}: {by[number + 1].title or '(untitled)'}")
    if previous_text:
        parts.append(f"What you said for the previous slide:\n{previous_text}")
    parts.append(f"<slide>\n{format_slide(slide)}\n</slide>")
    return "\n\n".join(parts)


def draw_message(deck: Deck, slide: Optional[Slide], explanation: Optional[str], request: Optional[str]) -> str:
    parts = [f"Presentation: {deck.name}"]
    if slide:
        parts.append(f"<slide>\n{format_slide(slide)}\n</slide>")
    if explanation:
        parts.append(f"What Flick is saying about it:\n{explanation}")
    if request:
        parts.append(f'The request: "{request}"')
    return "\n\n".join(parts)


# ── Reading Claude's JSON ───────────────────────────────────────────────────


def _json_object(text: str) -> Optional[dict]:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    return data if isinstance(data, dict) else None


def _num(value: Any, default: float, low: float, high: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = default
    return max(low, min(high, number))


def _short(value: Any, limit: int) -> str:
    text = " ".join(str(value or "").split())
    return text[:limit]


def clean_drawing(raw: Any) -> Optional[dict]:
    """Checks and tidies a drawing from Claude. Anything unusable is dropped; None if nothing is left."""
    if not isinstance(raw, dict):
        return None
    steps = [
        {"say": _short(s.get("say"), 400)}
        for s in (raw.get("steps") or [])
        if isinstance(s, dict) and _short(s.get("say"), 400)
    ][:MAX_STEPS]
    if not steps:
        return None
    last_step = len(steps)

    def step_of(el: dict) -> int:
        return int(_num(el.get("step"), 1, 1, last_step))

    def color(value: Any) -> str:
        return value if value in COLORS else "plum"

    shapes: list[dict] = []
    arrows: list[dict] = []
    ids: set[str] = set()
    for i, el in enumerate(raw.get("elements") or []):
        if not isinstance(el, dict) or len(shapes) + len(arrows) >= MAX_ELEMENTS:
            continue
        kind = el.get("type")
        ident = _short(el.get("id"), 20) or f"e{i}"
        if kind == "box":
            w = _num(el.get("w"), 180, 60, 420)
            h = _num(el.get("h"), 80, 40, 260)
            shapes.append({
                "id": ident, "type": "box", "step": step_of(el), "color": color(el.get("color")),
                "x": _num(el.get("x"), 100, 20, CANVAS_W - 20 - w), "y": _num(el.get("y"), 100, 20, CANVAS_H - 20 - h),
                "w": w, "h": h, "label": _short(el.get("label"), 40), "emoji": _short(el.get("emoji"), 8),
            })
        elif kind == "circle":
            r = _num(el.get("r"), 55, 25, 160)
            shapes.append({
                "id": ident, "type": "circle", "step": step_of(el), "color": color(el.get("color")),
                "x": _num(el.get("x"), 500, 20 + r, CANVAS_W - 20 - r), "y": _num(el.get("y"), 300, 20 + r, CANVAS_H - 20 - r),
                "r": r, "label": _short(el.get("label"), 40), "emoji": _short(el.get("emoji"), 8),
            })
        elif kind == "emoji":
            char = _short(el.get("char"), 8)
            if not char:
                continue
            size = _num(el.get("size"), 64, 28, 140)
            shapes.append({
                "id": ident, "type": "emoji", "step": step_of(el), "char": char, "size": size,
                "x": _num(el.get("x"), 500, 20 + size / 2, CANVAS_W - 20 - size / 2),
                "y": _num(el.get("y"), 300, 20 + size / 2, CANVAS_H - 40 - size / 2),
                "label": _short(el.get("label"), 40),
            })
        elif kind == "text":
            text = _short(el.get("text"), 70)
            if not text:
                continue
            shapes.append({
                "id": ident, "type": "text", "step": step_of(el), "color": color(el.get("color")), "text": text,
                "x": _num(el.get("x"), 500, 40, CANVAS_W - 40), "y": _num(el.get("y"), 300, 30, CANVAS_H - 20),
                "size": _num(el.get("size"), 26, 16, 48),
            })
        elif kind == "arrow":
            arrows.append({
                "type": "arrow", "step": step_of(el), "from": _short(el.get("from"), 20), "to": _short(el.get("to"), 20),
                "label": _short(el.get("label"), 30), "dashed": bool(el.get("dashed")),
            })
        else:
            continue
        if kind != "arrow":
            ids.add(ident)

    arrows = [a for a in arrows if a["from"] in ids and a["to"] in ids and a["from"] != a["to"]]
    elements = shapes + arrows
    if len(shapes) < 2:
        return None
    return {"title": _short(raw.get("title"), 60) or "Example", "elements": elements, "steps": steps}


def parse_lesson(text: str) -> tuple[str, Optional[dict]]:
    """→ (what to say, drawing or None). Falls back to the plain text if it isn't JSON."""
    data = _json_object(text)
    if data is None:
        plain = re.sub(r"\s+", " ", text).strip()
        return plain, None
    return " ".join(str(data.get("text") or "").split()), clean_drawing(data.get("drawing"))


def parse_drawing(text: str) -> Optional[dict]:
    data = _json_object(text)
    if data is None:
        return None
    return clean_drawing(data.get("drawing", data))
