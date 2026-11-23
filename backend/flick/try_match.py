"""Shows how a question scores against the active deck's prepared questions.

    python -m flick.try_match "Why use row level security?"

Use it to see whether matching by meaning would answer instantly, and to tune
MATCH_THRESHOLD in semantic.py for your decks.
"""

from __future__ import annotations

import sys

import numpy as np

from .__main__ import default_data_dir
from .db import Database
from .matcher import similarity
from .semantic import MATCH_THRESHOLD, MIN_MARGIN, LocalEmbedder, best_semantic_match


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        return
    question = " ".join(sys.argv[1:])
    data_dir = default_data_dir()
    db = Database(data_dir / "flick.db")
    deck_id = db.active_deck_id()
    deck = db.get_deck(deck_id) if deck_id else None
    if not deck or not deck.predicted:
        print("No active deck with prepared questions. Load and prepare a deck first.")
        return

    print("Loading the meaning model (downloads ~220 MB the first time)…")
    embedder = LocalEmbedder(data_dir / "models" / "meaning")
    embedder.load()
    if not embedder.ready():
        print("Could not load the model:", embedder.error)
        return

    q = embedder.embed([question])[0]
    vectors = embedder.embed([p.question for p in deck.predicted])
    scores = sorted(
        ((float(np.dot(q, v)), similarity(question, p.question), p) for v, p in zip(vectors, deck.predicted)),
        key=lambda s: s[0],
        reverse=True,
    )
    print(f"\nQuestion: {question}\n")
    print(" meaning  words  prepared question")
    for meaning, words, p in scores[:5]:
        print(f"  {meaning:5.2f}   {words:4.2f}  (slide {p.slide}) {p.question}")
    blobs = {p.id: np.asarray(v, dtype=np.float32).tobytes() for v, p in zip(vectors, deck.predicted)}
    match = best_semantic_match(q, deck.predicted, blobs)
    print(
        f"\nInstant answer: {'YES → ' + match.item.question if match else 'no (Claude would answer)'}"
        f"\n(needs meaning ≥ {MATCH_THRESHOLD} and {MIN_MARGIN} ahead of the next one)"
    )


if __name__ == "__main__":
    main()
