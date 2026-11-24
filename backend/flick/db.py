"""SQLite storage: settings, decks, slides, prepared questions and the Q&A log.

One file on the presenter's computer. WAL mode keeps reads fast while the
question predictor writes in the background.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
import threading
from pathlib import Path
from typing import Optional

from .models import Answer, Deck, DeckSummary, PredictedQuestion, Settings, Slide, WebSource

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL              -- JSON
);

CREATE TABLE IF NOT EXISTS decks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    file_path   TEXT NOT NULL UNIQUE,
    loaded_at   REAL NOT NULL,
    prep_status TEXT NOT NULL DEFAULT 'idle'
                CHECK (prep_status IN ('idle', 'preparing', 'ready', 'error')),
    prep_error  TEXT,
    active      INTEGER NOT NULL DEFAULT 0
);
-- At most one active deck.
CREATE UNIQUE INDEX IF NOT EXISTS one_active_deck ON decks(active) WHERE active = 1;

CREATE TABLE IF NOT EXISTS slides (
    deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    number  INTEGER NOT NULL CHECK (number > 0),
    title   TEXT NOT NULL DEFAULT '',
    body    TEXT NOT NULL DEFAULT '',
    notes   TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (deck_id, number)
);

CREATE TABLE IF NOT EXISTS predicted_questions (
    id       TEXT PRIMARY KEY,
    deck_id  TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
    slide    INTEGER NOT NULL DEFAULT 0,      -- 0 = the talk as a whole
    question TEXT NOT NULL,
    answer   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS predicted_by_deck ON predicted_questions(deck_id, slide);

CREATE TABLE IF NOT EXISTS qa_log (
    id            TEXT PRIMARY KEY,
    deck_id       TEXT REFERENCES decks(id) ON DELETE SET NULL,
    question      TEXT NOT NULL,
    answer        TEXT NOT NULL,
    origin        TEXT NOT NULL,
    sources       TEXT NOT NULL DEFAULT '[]', -- JSON list of {title, url}
    current_slide INTEGER,
    duration_ms   INTEGER NOT NULL DEFAULT 0,
    timestamp     REAL NOT NULL,
    spoken        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS log_by_time ON qa_log(timestamp DESC);

-- Slide explanations written before the talk, so "explain this slide" starts at once.
CREATE TABLE IF NOT EXISTS slide_explanations (
    deck_id TEXT NOT NULL,
    number  INTEGER NOT NULL,
    text    TEXT NOT NULL,
    PRIMARY KEY (deck_id, number),
    FOREIGN KEY (deck_id, number) REFERENCES slides(deck_id, number) ON DELETE CASCADE
);

-- Meaning vectors of prepared questions, for matching questions by meaning.
CREATE TABLE IF NOT EXISTS question_embeddings (
    question_id TEXT PRIMARY KEY REFERENCES predicted_questions(id) ON DELETE CASCADE,
    model       TEXT NOT NULL,
    vector      BLOB NOT NULL            -- float32, normalised
);
"""

#: Answers kept for review after talks.
MAX_LOG_ENTRIES = 1000


class Database:
    def __init__(self, path: Path | str):
        self.path = str(path)
        # One connection shared across threads, guarded by a lock: SQLite is
        # fast enough that serialising access costs nothing noticeable here.
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        with self._lock:
            self._conn.execute("PRAGMA foreign_keys = ON")
            if self.path != ":memory:":
                self._conn.execute("PRAGMA journal_mode = WAL")
            self._conn.executescript(SCHEMA)
            # A prep that was running when the app closed will never finish.
            self._conn.execute(
                "UPDATE decks SET prep_status = 'error', "
                "prep_error = 'Preparation was interrupted. Press Prepare to run it again.' "
                "WHERE prep_status = 'preparing'"
            )
            self._conn.commit()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # ── Settings ────────────────────────────────────────────────────────────

    def get_settings(self) -> Settings:
        with self._lock:
            rows = self._conn.execute("SELECT key, value FROM settings").fetchall()
        stored = {r["key"]: json.loads(r["value"]) for r in rows}
        known = {k: v for k, v in stored.items() if k in Settings.model_fields}
        return Settings(**known)

    def update_settings(self, changes: dict) -> Settings:
        merged = self.get_settings().model_copy(update=changes)
        Settings.model_validate(merged.model_dump())  # reject invalid values
        with self._lock:
            self._conn.executemany(
                "INSERT INTO settings(key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                [(k, json.dumps(v)) for k, v in changes.items()],
            )
            self._conn.commit()
        return merged

    # ── Decks ───────────────────────────────────────────────────────────────

    def save_deck(self, deck: Deck, activate: bool = True) -> None:
        """Insert or replace a deck with its slides. Prepared questions are reset."""
        with self._lock:
            c = self._conn
            c.execute("DELETE FROM decks WHERE id = ? OR file_path = ?", (deck.id, deck.file_path))
            if activate:
                c.execute("UPDATE decks SET active = 0 WHERE active = 1")
            c.execute(
                "INSERT INTO decks(id, name, file_path, loaded_at, prep_status, prep_error, active) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (deck.id, deck.name, deck.file_path, deck.loaded_at, deck.prep_status, deck.prep_error, int(activate)),
            )
            c.executemany(
                "INSERT INTO slides(deck_id, number, title, body, notes) VALUES (?, ?, ?, ?, ?)",
                [(deck.id, s.number, s.title, s.body, s.notes) for s in deck.slides],
            )
            c.executemany(
                "INSERT INTO predicted_questions(id, deck_id, slide, question, answer) VALUES (?, ?, ?, ?, ?)",
                [(q.id, deck.id, q.slide, q.question, q.answer) for q in deck.predicted],
            )
            c.commit()

    def find_deck_by_path(self, file_path: str) -> Optional[str]:
        with self._lock:
            row = self._conn.execute("SELECT id FROM decks WHERE file_path = ?", (file_path,)).fetchone()
        return row["id"] if row else None

    def get_deck(self, deck_id: str) -> Optional[Deck]:
        with self._lock:
            c = self._conn
            row = c.execute("SELECT * FROM decks WHERE id = ?", (deck_id,)).fetchone()
            if not row:
                return None
            slides = c.execute(
                "SELECT number, title, body, notes FROM slides WHERE deck_id = ? ORDER BY number", (deck_id,)
            ).fetchall()
            predicted = c.execute(
                "SELECT id, slide, question, answer FROM predicted_questions WHERE deck_id = ? ORDER BY slide, rowid",
                (deck_id,),
            ).fetchall()
        return Deck(
            id=row["id"],
            name=row["name"],
            file_path=row["file_path"],
            loaded_at=row["loaded_at"],
            prep_status=row["prep_status"],
            prep_error=row["prep_error"],
            slides=[Slide(**dict(s)) for s in slides],
            predicted=[PredictedQuestion(**dict(q)) for q in predicted],
        )

    def active_deck_id(self) -> Optional[str]:
        with self._lock:
            row = self._conn.execute("SELECT id FROM decks WHERE active = 1").fetchone()
        return row["id"] if row else None

    def list_decks(self) -> list[DeckSummary]:
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT d.*,
                       (SELECT COUNT(*) FROM slides s WHERE s.deck_id = d.id) AS slide_count,
                       (SELECT COUNT(*) FROM predicted_questions q WHERE q.deck_id = d.id) AS question_count,
                       (SELECT COUNT(*) FROM slide_explanations e WHERE e.deck_id = d.id) AS explanation_count
                FROM decks d ORDER BY d.loaded_at DESC
                """
            ).fetchall()
        return [
            DeckSummary(
                id=r["id"],
                name=r["name"],
                loaded_at=r["loaded_at"],
                slide_count=r["slide_count"],
                question_count=r["question_count"],
                explanation_count=r["explanation_count"],
                prep_status=r["prep_status"],
                prep_error=r["prep_error"],
                active=bool(r["active"]),
            )
            for r in rows
        ]

    def activate_deck(self, deck_id: str) -> bool:
        with self._lock:
            if not self._conn.execute("SELECT 1 FROM decks WHERE id = ?", (deck_id,)).fetchone():
                return False
            self._conn.execute("UPDATE decks SET active = 0 WHERE active = 1")
            self._conn.execute("UPDATE decks SET active = 1 WHERE id = ?", (deck_id,))
            self._conn.commit()
        return True

    def delete_deck(self, deck_id: str) -> None:
        with self._lock:
            was_active = self._conn.execute("SELECT active FROM decks WHERE id = ?", (deck_id,)).fetchone()
            self._conn.execute("DELETE FROM decks WHERE id = ?", (deck_id,))
            if was_active and was_active["active"]:
                newest = self._conn.execute("SELECT id FROM decks ORDER BY loaded_at DESC LIMIT 1").fetchone()
                if newest:
                    self._conn.execute("UPDATE decks SET active = 1 WHERE id = ?", (newest["id"],))
            self._conn.commit()

    def set_prep_status(self, deck_id: str, status: str, error: Optional[str] = None) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE decks SET prep_status = ?, prep_error = ? WHERE id = ?", (status, error, deck_id)
            )
            self._conn.commit()

    def replace_predicted(self, deck_id: str, questions: list[PredictedQuestion]) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM predicted_questions WHERE deck_id = ?", (deck_id,))
            self._conn.executemany(
                "INSERT INTO predicted_questions(id, deck_id, slide, question, answer) VALUES (?, ?, ?, ?, ?)",
                [(q.id, deck_id, q.slide, q.question, q.answer) for q in questions],
            )
            self._conn.commit()

    def get_question(self, question_id: str) -> Optional[PredictedQuestion]:
        with self._lock:
            row = self._conn.execute(
                "SELECT id, slide, question, answer FROM predicted_questions WHERE id = ?", (question_id,)
            ).fetchone()
        return PredictedQuestion(**dict(row)) if row else None

    def question_deck_id(self, question_id: str) -> Optional[str]:
        with self._lock:
            row = self._conn.execute("SELECT deck_id FROM predicted_questions WHERE id = ?", (question_id,)).fetchone()
        return row["deck_id"] if row else None

    def add_question(self, deck_id: str, slide: int, question: str, answer: str) -> PredictedQuestion:
        q = PredictedQuestion(id=str(uuid.uuid4()), slide=slide, question=question, answer=answer)
        with self._lock:
            self._conn.execute(
                "INSERT INTO predicted_questions(id, deck_id, slide, question, answer) VALUES (?, ?, ?, ?, ?)",
                (q.id, deck_id, q.slide, q.question, q.answer),
            )
            self._conn.commit()
        return q

    def update_question(
        self,
        question_id: str,
        question: Optional[str] = None,
        answer: Optional[str] = None,
        slide: Optional[int] = None,
    ) -> Optional[PredictedQuestion]:
        """Changes only the given fields. A new question text drops its meaning vector (re-made on next use)."""
        current = self.get_question(question_id)
        if current is None:
            return None
        updated = current.model_copy(
            update={k: v for k, v in {"question": question, "answer": answer, "slide": slide}.items() if v is not None}
        )
        with self._lock:
            self._conn.execute(
                "UPDATE predicted_questions SET slide = ?, question = ?, answer = ? WHERE id = ?",
                (updated.slide, updated.question, updated.answer, question_id),
            )
            if updated.question != current.question:
                self._conn.execute("DELETE FROM question_embeddings WHERE question_id = ?", (question_id,))
            self._conn.commit()
        return updated

    def delete_question(self, question_id: str) -> bool:
        """True if it existed. Its meaning vector goes with it (ON DELETE CASCADE)."""
        with self._lock:
            cur = self._conn.execute("DELETE FROM predicted_questions WHERE id = ?", (question_id,))
            self._conn.commit()
        return cur.rowcount > 0

    # ── Slide explanations ──────────────────────────────────────────────────

    def save_explanations(self, deck_id: str, explanations: dict[int, str]) -> None:
        with self._lock:
            self._conn.executemany(
                "INSERT INTO slide_explanations(deck_id, number, text) VALUES (?, ?, ?) "
                "ON CONFLICT(deck_id, number) DO UPDATE SET text = excluded.text",
                [(deck_id, n, t) for n, t in explanations.items()],
            )
            self._conn.commit()

    def get_explanation(self, deck_id: str, number: int) -> Optional[str]:
        with self._lock:
            row = self._conn.execute(
                "SELECT text FROM slide_explanations WHERE deck_id = ? AND number = ?", (deck_id, number)
            ).fetchone()
        return row["text"] if row else None

    def get_explanations(self, deck_id: str) -> dict[int, str]:
        """Every slide explanation of a deck, by slide number."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT number, text FROM slide_explanations WHERE deck_id = ? ORDER BY number", (deck_id,)
            ).fetchall()
        return {r["number"]: r["text"] for r in rows}

    def explanation_count(self, deck_id: str) -> int:
        with self._lock:
            return self._conn.execute("SELECT COUNT(*) FROM slide_explanations WHERE deck_id = ?", (deck_id,)).fetchone()[0]

    # ── Question embeddings ─────────────────────────────────────────────────

    def save_embeddings(self, model: str, vectors: dict[str, bytes]) -> None:
        with self._lock:
            self._conn.executemany(
                "INSERT INTO question_embeddings(question_id, model, vector) VALUES (?, ?, ?) "
                "ON CONFLICT(question_id) DO UPDATE SET model = excluded.model, vector = excluded.vector",
                [(qid, model, v) for qid, v in vectors.items()],
            )
            self._conn.commit()

    def get_embeddings(self, deck_id: str, model: str) -> dict[str, bytes]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT e.question_id, e.vector FROM question_embeddings e "
                "JOIN predicted_questions q ON q.id = e.question_id WHERE q.deck_id = ? AND e.model = ?",
                (deck_id, model),
            ).fetchall()
        return {r["question_id"]: r["vector"] for r in rows}

    # ── Q&A log ─────────────────────────────────────────────────────────────

    def add_log(self, answer: Answer, deck_id: Optional[str]) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO qa_log(id, deck_id, question, answer, origin, sources, current_slide, duration_ms, timestamp, spoken) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    answer.id,
                    deck_id,
                    answer.question,
                    answer.answer,
                    answer.origin,
                    json.dumps([s.model_dump() for s in answer.sources]),
                    answer.current_slide,
                    answer.duration_ms,
                    answer.timestamp,
                    int(answer.speak),
                ),
            )
            self._conn.execute(
                "DELETE FROM qa_log WHERE id NOT IN (SELECT id FROM qa_log ORDER BY timestamp DESC LIMIT ?)",
                (MAX_LOG_ENTRIES,),
            )
            self._conn.commit()

    def get_log(self, limit: int = MAX_LOG_ENTRIES, since: Optional[float] = None) -> list[Answer]:
        """Newest first."""
        query = "SELECT * FROM qa_log"
        args: list = []
        if since is not None:
            query += " WHERE timestamp >= ?"
            args.append(since)
        query += " ORDER BY timestamp DESC LIMIT ?"
        args.append(limit)
        with self._lock:
            rows = self._conn.execute(query, args).fetchall()
        return [
            Answer(
                id=r["id"],
                question=r["question"],
                answer=r["answer"],
                origin=r["origin"],
                sources=[WebSource(**s) for s in json.loads(r["sources"])],
                current_slide=r["current_slide"],
                duration_ms=r["duration_ms"],
                timestamp=r["timestamp"],
                speak=bool(r["spoken"]),
            )
            for r in rows
        ]

    def clear_log(self) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM qa_log")
            self._conn.commit()
