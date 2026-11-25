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
from .prompts import format_slide

Style = Literal["class", "story", "professional", "exam"]
STYLES: dict[str, str] = {
    "class": "Standard",
    "story": "Story mode",
    "professional": "Professional mode",
    "exam": "Exam mode",
}

#: Size of the whiteboard. Claude places things on this grid; the screen scales it.
CANVAS_W, CANVAS_H = 1000, 600
COLORS = ("plum", "aqua", "amber", "rose", "green", "gray")
MAX_ELEMENTS = 18
MAX_STEPS = 7

LESSON_MAX_TOKENS = 2600
DRAW_MAX_TOKENS = 2000

# ── Prompts ─────────────────────────────────────────────────────────────────

_STYLE_GUIDE = {
    "story": """STORY MODE. Teach through one continuing story. Use the same small cast across the whole deck
(e.g. Ali and Sara, two university students in Lahore, their teacher Ms. Ayesha, a chai dhaba, a cricket
match, a family business). Each slide is the next scene of the story, and the scene makes the slide's idea
obvious; then say plainly, in one sentence, what the idea is. Keep it warm and vivid, not childish.""",
    "professional": """PROFESSIONAL MODE. Precise and concise, like a senior engineer briefing a colleague. Use the
correct technical terms (and say what each means in a few words), give one real-world industry example
(a bank, an app, a hospital, a company like Daraz or Careem), and mention a common pitfall if there is one.""",
    "exam": """EXAM MODE. The student has an exam soon. Give: the key points to remember (short, numbered, said
naturally: "First... Second..."), any definition they must know word-for-word, one memory trick (a mnemonic
or a simple picture in the mind), and end with "A likely exam question:" followed by the question and a short
model answer. Be brief and high-yield; skip anything that would not get marks.""",
}

LESSON_SYSTEM = """You are Flick, a friendly tutor helping a university student study a presentation, one
slide at a time. You are given the slide, the slides around it and (if any) what you said for the previous
slide. Write what Flick SAYS for this slide, in the requested style.

{style_guide}

Rules:
- Short: about 60-110 words. It is spoken aloud.
- Plain, natural spoken English (Pakistani students; Roman Urdu words are fine if the deck uses them).
  No markdown, no bullet symbols, no headings, no emojis.
- Continue naturally from the previous slide; do not greet again after slide 1. Never say "this slide".
- Use only what the slide supports plus well-known general knowledge. If the slide is only a title,
  agenda or thank-you slide, say one short natural sentence and move on.

Then decide whether a small whiteboard drawing would REALLY help this slide (see the drawing rules).

Reply with ONLY this JSON:
{{"text": "...", "drawing": <drawing object or null>}}

{draw_rules}"""

DRAW_RULES = f"""Drawing rules (the whiteboard is {CANVAS_W} x {CANVAS_H}, origin top-left):
- Draw ONLY when the idea is complex or abstract: a process or flow, how parts relate, a comparison,
  cause and effect, a structure, something that is hard to picture. Do NOT draw for a title, agenda,
  summary, thank-you slide, or a simple list. When in doubt, don't draw (use null).
- A drawing is a small, clear picture, like a teacher sketching on a whiteboard: 4-14 elements.
- Element types:
  {{"id":"a","type":"box","x":120,"y":220,"w":200,"h":90,"label":"Database","emoji":"🗄️","color":"plum","step":1}}
  {{"id":"b","type":"circle","x":600,"y":260,"r":60,"label":"User","emoji":"🙂","color":"aqua","step":2}}
  {{"id":"c","type":"emoji","x":820,"y":120,"char":"👩‍🏫","size":70,"label":"Teacher","step":2}}
  {{"type":"arrow","from":"a","to":"b","label":"sends data","step":3}}  (from/to are element ids)
  {{"type":"text","x":500,"y":560,"text":"Only your own rows!","size":30,"color":"rose","step":4}}
  box x,y = top-left corner; circle and emoji x,y = centre; text x,y = centre of the text.
- Colours: {", ".join(COLORS)}. Labels: at most 4 words. Keep everything 40px inside the edges,
  leave at least 60px between shapes, no overlaps. Spread the picture across the board, left to right
  or top to bottom, in the order things happen.
- "steps": 3-6 steps. Step 1 shows the first elements, each next step adds more (every element has the
  step number when it appears). Each step has "say": 1-2 short spoken sentences describing what is being
  drawn right now ("Here's Ali at the bank counter..."). In story style the drawing shows the story's scene.
- Drawing object: {{"title":"Short title","elements":[...],"steps":[{{"say":"..."}}, ...]}}"""

DRAW_SYSTEM = """You are Flick, a friendly AI presenter with a whiteboard. Plan ONE small drawing that explains
an idea from a presentation slide, in the requested style. The drawing is revealed step by step while Flick
says each step's sentence.

{style_guide}

{draw_rules}

{when}

Reply with ONLY the JSON: {{"drawing": <drawing object or null>}}"""

_WHEN_AUTO = """Decide first whether a drawing would really help this slide. If not, reply {"drawing": null}."""
_WHEN_ASKED = """Someone ASKED for this ("draw it", "give an example", "explain with a story"): always draw.
Answer their request: if they asked about something specific, draw that. If they asked for an example or a story,
the drawing is a concrete daily-life example or a short story scene."""

_CLASS_GUIDE = """STANDARD STYLE. Clear and friendly, like a good teacher explaining to the class, with a simple
everyday example."""


def style_guide(style: str) -> str:
    return _STYLE_GUIDE.get(style, _CLASS_GUIDE)


def lesson_system(style: str) -> str:
    return LESSON_SYSTEM.format(style_guide=style_guide(style), draw_rules=DRAW_RULES)


def draw_system(style: str, asked: bool) -> str:
    return DRAW_SYSTEM.format(style_guide=style_guide(style), draw_rules=DRAW_RULES, when=_WHEN_ASKED if asked else _WHEN_AUTO)


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
