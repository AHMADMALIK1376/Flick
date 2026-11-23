"""Matching questions by meaning, not just by words.

"Why use row-level security?" and "What is Row-Level Security and how does it
differ from a WHERE clause?" share few words but ask the same thing. Each
prepared question is turned into a meaning vector once (after preparation)
and stored in SQLite; a live question is turned into one vector (~20 ms on a
laptop CPU) and compared with them all.

The model runs on the computer (no API call, no cost) and understands
English, Urdu and Roman Urdu. It is downloaded once (~220 MB) on first use.
Until it is ready, Flick simply uses word matching.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Protocol, Sequence

import numpy as np

from .models import PredictedQuestion

MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

#: Cosine similarity at or above which a prepared answer is used directly.
#: Conservative: a wrong match reads the wrong answer to the room, while a
#: miss only costs one Claude call. Tune with `python -m flick.try_match`.
MATCH_THRESHOLD = 0.84
#: The best match must beat the runner-up by this much, so two similar
#: prepared questions ("What is RLS?" / "Why index RLS columns?") are not
#: confused with each other.
MIN_MARGIN = 0.04


class Embedder(Protocol):
    name: str

    def ready(self) -> bool: ...

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        """One normalised float32 row per text."""
        ...


class LocalEmbedder:
    """fastembed (ONNX) on the CPU. Loads in the background; never blocks an answer."""

    name = MODEL_NAME

    def __init__(self, cache_dir: Optional[Path] = None):
        self._cache_dir = str(cache_dir) if cache_dir else None
        self._model = None
        self._lock = threading.Lock()
        self.error: Optional[str] = None

    def load(self) -> None:
        """Blocking load (download on first run). Call from a worker thread."""
        with self._lock:
            if self._model is not None or self.error:
                return
            try:
                from fastembed import TextEmbedding

                self._model = TextEmbedding(model_name=MODEL_NAME, cache_dir=self._cache_dir)
            except Exception as err:  # not installed, offline on first run, etc.
                self.error = str(err)

    def ready(self) -> bool:
        return self._model is not None

    def embed(self, texts: Sequence[str]) -> np.ndarray:
        if self._model is None:
            raise RuntimeError("The meaning model is not loaded yet.")
        vectors = np.array(list(self._model.embed(list(texts))), dtype=np.float32)
        return _normalise(vectors)


@dataclass
class SemanticMatch:
    item: PredictedQuestion
    score: float
    runner_up: float


def best_semantic_match(
    question_vector: np.ndarray,
    items: Sequence[PredictedQuestion],
    vectors: dict[str, bytes],
    threshold: float = MATCH_THRESHOLD,
    margin: float = MIN_MARGIN,
) -> Optional[SemanticMatch]:
    scored = []
    for item in items:
        blob = vectors.get(item.id)
        if blob is None:
            continue
        scored.append((float(np.dot(question_vector, np.frombuffer(blob, dtype=np.float32))), item))
    if not scored:
        return None
    scored.sort(key=lambda s: s[0], reverse=True)
    best_score, best = scored[0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0
    # The same question asked about two slides can tie; that is not ambiguity.
    if len(scored) > 1 and scored[1][1].question.strip().lower() == best.question.strip().lower():
        runner_up = scored[2][0] if len(scored) > 2 else 0.0
    if best_score >= threshold and best_score - runner_up >= margin:
        return SemanticMatch(best, best_score, runner_up)
    return None


def to_blob(vector: np.ndarray) -> bytes:
    return np.asarray(vector, dtype=np.float32).tobytes()


def _normalise(v: np.ndarray) -> np.ndarray:
    norms = np.linalg.norm(v, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return v / norms
