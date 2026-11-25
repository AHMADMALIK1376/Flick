"""Token Analyzer: how many Claude tokens (and how much money) each part of Flick uses.

Every Claude call is recorded with what it was for (a question, the talk for a slide, a
drawing, an example, getting the deck ready...), the slide, the mode, and the "card" it
belongs to: a whole presentation or study session, one slide explained on request, the
questions asked outside a talk, or a deck's preparation.

What a call is for travels with the code that makes it, in a context variable: set it with
`tagged(kind=..., slide=...)` around the call; tasks started inside inherit it.
"""

from __future__ import annotations

import contextlib
import contextvars
import time
import uuid
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING, Any, Iterator, Optional

if TYPE_CHECKING:
    from .db import Database
    from .events import EventBus

# ── What a call was for ──────────────────────────────────────────────────────

#: kind → name shown in the analyzer
KINDS: dict[str, str] = {
    "talk": "Slide talk (what Flick says)",
    "drawing": "Whiteboard drawings",
    "example": "Examples on request",
    "question": "Questions from the audience",
    "explain": "Explain this slide",
    "prep": "Getting the deck ready",
    "other": "Other",
}

#: card type → name
CARD_TYPES: dict[str, str] = {
    "presentation": "Whole presentation",
    "study": "Study session",
    "slide": "Single slide",
    "questions": "Questions",
    "prep": "Deck preparation",
}


@dataclass
class LazyCard:
    """A card made only when its first call is counted (a cached answer costs nothing, so no card).
    `title` may contain {slide}."""

    type: str
    title: str
    deck_id: Optional[str] = None
    deck_name: Optional[str] = None
    style: Optional[str] = None
    key: Optional[str] = None
    id: Optional[str] = None


@dataclass(frozen=True)
class Tag:
    kind: str = "other"
    card: "str | LazyCard | None" = None  # usage card id (or one made on first use)
    deck_id: Optional[str] = None
    slide: Optional[int] = None
    style: Optional[str] = None
    #: Ids of the rows recorded under this tag are appended here (to split a call afterwards).
    sink: Optional[list] = None


_current: contextvars.ContextVar[Tag] = contextvars.ContextVar("flick_usage_tag", default=Tag())


def current_tag() -> Tag:
    return _current.get()


@contextlib.contextmanager
def tagged(**changes: Any) -> Iterator[Tag]:
    """Calls made inside (and tasks started inside) are counted with these details.
    Details not given are kept from the surrounding tag (e.g. the presentation's card)."""
    tag = replace(_current.get(), **{k: v for k, v in changes.items() if v is not None})
    token = _current.set(tag)
    try:
        yield tag
    finally:
        _current.reset(token)


def set_tag(**changes: Any) -> None:
    """Like `tagged`, for the rest of the current task (e.g. a whole talk)."""
    _current.set(replace(_current.get(), **{k: v for k, v in changes.items() if v is not None}))


# ── Prices (USD per million tokens), Claude API list prices, November 2026 ──

#: model prefix → (input, output, cache write 5 min, cache read)
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-haiku-5-5": (0.10, 0.50, 0.125, 0.01),
    "claude-sonnet-5-5": (2.00, 10.00, 2.50, 0.10),
    "claude-opus-5-5": (4.00, 20.00, 5.00, 0.40),
}
#: Haiku 5.5 only: a prompt over this many tokens pays 5x for the whole request.
HAIKU_LONG_PROMPT = 100_000
WEB_SEARCH_USD = 10.0 / 1000  # per search


def price_for(model: str) -> tuple[float, float, float, float]:
    for prefix, price in PRICES.items():
        if model.startswith(prefix):
            return price
    return PRICES["claude-haiku-5-5"]


def cost_usd(model: str, input_tokens: int, output_tokens: int, cache_write: int, cache_read: int, searches: int) -> float:
    p_in, p_out, p_write, p_read = price_for(model)
    if model.startswith("claude-haiku-5-5") and input_tokens + cache_write + cache_read > HAIKU_LONG_PROMPT:
        p_in, p_out, p_write, p_read = (x * 5 for x in (p_in, p_out, p_write, p_read))
    tokens = input_tokens * p_in + output_tokens * p_out + cache_write * p_write + cache_read * p_read
    return tokens / 1_000_000 + searches * WEB_SEARCH_USD


def _num(obj: Any, name: str) -> int:
    value = obj.get(name) if isinstance(obj, dict) else getattr(obj, name, None)
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


# ── Storage and summaries ───────────────────────────────────────────────────

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage_cards (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    deck_id    TEXT,
    deck_name  TEXT,
    style      TEXT,
    slide      INTEGER,
    title      TEXT NOT NULL,
    key        TEXT,                -- find-or-create key (questions per deck per day, prep per deck)
    started_at REAL NOT NULL,
    ended_at   REAL
);
CREATE INDEX IF NOT EXISTS usage_cards_key ON usage_cards(key);
CREATE TABLE IF NOT EXISTS usage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id     TEXT REFERENCES usage_cards(id) ON DELETE CASCADE,
    at          REAL NOT NULL,
    kind        TEXT NOT NULL,
    slide       INTEGER,
    style       TEXT,
    model       TEXT NOT NULL,
    input       INTEGER NOT NULL,
    output      INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    cache_read  INTEGER NOT NULL,
    searches    INTEGER NOT NULL,
    cost        REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_card ON usage(card_id);
"""

#: Cards kept (oldest are removed).
MAX_CARDS = 300


class UsageMeter:
    def __init__(self, db: "Database", events: Optional["EventBus"] = None, clock=time.time):
        self.db = db
        self.events = events
        self.clock = clock
        with db._lock:
            db._conn.executescript(SCHEMA)
            db._conn.commit()

    # ── Cards ───────────────────────────────────────────────────────────────

    def open_card(
        self,
        type: str,
        title: str,
        deck_id: Optional[str] = None,
        deck_name: Optional[str] = None,
        style: Optional[str] = None,
        slide: Optional[int] = None,
        key: Optional[str] = None,
    ) -> str:
        """A new card, or (with `key`) the existing card with that key."""
        with self.db._lock:
            conn = self.db._conn
            if key:
                row = conn.execute("SELECT id FROM usage_cards WHERE key = ?", (key,)).fetchone()
                if row:
                    return row["id"]
            card_id = str(uuid.uuid4())
            conn.execute(
                "INSERT INTO usage_cards(id, type, deck_id, deck_name, style, slide, title, key, started_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (card_id, type, deck_id, deck_name, style, slide, title, key, self.clock()),
            )
            conn.execute(
                "DELETE FROM usage_cards WHERE id NOT IN (SELECT id FROM usage_cards ORDER BY started_at DESC LIMIT ?)",
                (MAX_CARDS,),
            )
            conn.commit()
        return card_id

    def _card_id(self, tag: Tag) -> Optional[str]:
        card = tag.card
        if isinstance(card, LazyCard):
            if card.id is None:
                card.id = self.open_card(
                    card.type,
                    card.title.format(slide=tag.slide if tag.slide is not None else "?"),
                    deck_id=card.deck_id,
                    deck_name=card.deck_name,
                    style=card.style or tag.style,
                    slide=tag.slide if card.type == "slide" else None,
                    key=card.key,
                )
            return card.id
        return card

    def close_card(self, card_id: Optional[str]) -> None:
        if not card_id:
            return
        with self.db._lock:
            self.db._conn.execute("UPDATE usage_cards SET ended_at = ? WHERE id = ?", (self.clock(), card_id))
            self.db._conn.commit()
        self._publish(card_id)

    # ── Recording ───────────────────────────────────────────────────────────

    def record(self, model: str, usage: Any, tag: Optional[Tag] = None) -> Optional[dict]:
        """Records one Claude response's `usage`. Never raises: counting must not break an answer."""
        if usage is None:
            return None
        try:
            tag = tag or current_tag()
            server = usage.get("server_tool_use") if isinstance(usage, dict) else getattr(usage, "server_tool_use", None)
            row = {
                "input": _num(usage, "input_tokens"),
                "output": _num(usage, "output_tokens"),
                "cache_write": _num(usage, "cache_creation_input_tokens"),
                "cache_read": _num(usage, "cache_read_input_tokens"),
                "searches": _num(server, "web_search_requests") if server is not None else 0,
            }
            row["cost"] = cost_usd(model, **{k: row[k] for k in ("cache_write", "cache_read", "searches")},
                                   input_tokens=row["input"], output_tokens=row["output"])
            card_id = self._card_id(tag)
            with self.db._lock:
                cursor = self.db._conn.execute(
                    "INSERT INTO usage(card_id, at, kind, slide, style, model, input, output, cache_write, cache_read, searches, cost) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (card_id, self.clock(), tag.kind if tag.kind in KINDS else "other", tag.slide, tag.style, model,
                     row["input"], row["output"], row["cache_write"], row["cache_read"], row["searches"], row["cost"]),
                )
                self.db._conn.commit()
            row["id"] = cursor.lastrowid
            if tag.sink is not None:
                tag.sink.append(row["id"])
            self._publish(card_id)
            return row
        except Exception:
            return None

    def _publish(self, card_id: Optional[str]) -> None:
        if self.events is None:
            return
        try:
            card = self.card(card_id) if card_id else None
            self.events.publish("usage", {"card": card, "total": self.total()})
        except Exception:
            pass

    def split(self, row_ids: list, kind: str, share: float) -> None:
        """Moves `share` (0-1) of these rows to `kind`: one call that wrote both the talk and its
        drawing is shown as two parts, by how much of the reply each took."""
        share = max(0.0, min(1.0, share))
        if not row_ids or share <= 0:
            return
        cols = ("input", "output", "cache_write", "cache_read")
        with self.db._lock:
            conn = self.db._conn
            for row_id in row_ids:
                r = conn.execute("SELECT * FROM usage WHERE id = ?", (row_id,)).fetchone()
                if r is None:
                    continue
                moved = {c: round(r[c] * share) for c in cols}
                cost = r["cost"] * share
                conn.execute(
                    "INSERT INTO usage(card_id, at, kind, slide, style, model, input, output, cache_write, cache_read, searches, cost) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)",
                    (r["card_id"], r["at"], kind, r["slide"], r["style"], r["model"], *[moved[c] for c in cols], cost),
                )
                conn.execute(
                    "UPDATE usage SET input = ?, output = ?, cache_write = ?, cache_read = ?, cost = ? WHERE id = ?",
                    (*[r[c] - moved[c] for c in cols], r["cost"] - cost, row_id),
                )
            conn.commit()

    # ── Reading ─────────────────────────────────────────────────────────────

    def _sums(self, where: str, args: tuple) -> dict:
        with self.db._lock:
            row = self.db._conn.execute(
                "SELECT COUNT(*) AS calls, COALESCE(SUM(input),0) AS input, COALESCE(SUM(output),0) AS output, "
                "COALESCE(SUM(cache_write),0) AS cache_write, COALESCE(SUM(cache_read),0) AS cache_read, "
                f"COALESCE(SUM(searches),0) AS searches, COALESCE(SUM(cost),0) AS cost FROM usage {where}",
                args,
            ).fetchone()
        out = dict(row)
        out["tokens"] = out["input"] + out["output"] + out["cache_write"] + out["cache_read"]
        return out

    def total(self) -> dict:
        return self._sums("", ())

    def _groups(self, card_id: str, column: str) -> list[dict]:
        with self.db._lock:
            rows = self.db._conn.execute(
                f"SELECT {column} AS key, COUNT(*) AS calls, SUM(input) AS input, SUM(output) AS output, "
                "SUM(cache_write) AS cache_write, SUM(cache_read) AS cache_read, SUM(searches) AS searches, "
                f"SUM(cost) AS cost FROM usage WHERE card_id = ? GROUP BY {column} ORDER BY cost DESC",
                (card_id,),
            ).fetchall()
        groups = []
        for r in rows:
            g = dict(r)
            g["tokens"] = g["input"] + g["output"] + g["cache_write"] + g["cache_read"]
            groups.append(g)
        return groups

    def card(self, card_id: str) -> Optional[dict]:
        with self.db._lock:
            row = self.db._conn.execute("SELECT * FROM usage_cards WHERE id = ?", (card_id,)).fetchone()
        if row is None:
            return None
        card = {k: row[k] for k in ("id", "type", "deck_id", "deck_name", "style", "slide", "title", "started_at", "ended_at")}
        card["type_name"] = CARD_TYPES.get(card["type"], card["type"])
        card["totals"] = self._sums("WHERE card_id = ?", (card_id,))
        card["by_kind"] = []
        for g in self._groups(card_id, "kind"):
            kind = g.pop("key") or "other"
            card["by_kind"].append({**g, "kind": kind, "name": KINDS.get(kind, "Other")})
        by_slide = [{**g, "slide": g.pop("key")} for g in self._groups(card_id, "slide")]
        card["by_slide"] = sorted(by_slide, key=lambda g: (g["slide"] is None, g["slide"] or 0))
        with self.db._lock:
            models = self.db._conn.execute("SELECT DISTINCT model FROM usage WHERE card_id = ?", (card_id,)).fetchall()
        card["models"] = [m["model"] for m in models]
        return card

    def cards(self, limit: int = 100) -> list[dict]:
        with self.db._lock:
            ids = [
                r["id"]
                for r in self.db._conn.execute(
                    "SELECT c.id FROM usage_cards c WHERE c.type IN ('presentation', 'study') "
                    "OR EXISTS (SELECT 1 FROM usage u WHERE u.card_id = c.id) "
                    "ORDER BY c.started_at DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            ]
        return [c for c in (self.card(i) for i in ids) if c]

    def clear(self) -> None:
        with self.db._lock:
            self.db._conn.execute("DELETE FROM usage")
            self.db._conn.execute("DELETE FROM usage_cards")
            self.db._conn.commit()
