"""Instant, offline matching of a live question against the questions prepared
before the talk. When confident, Flick answers with no AI call at all.

Deliberately conservative: a near-miss only costs one AI call (the prepared
answers are in Claude's context anyway), but a wrong match reads the wrong
answer to a room full of people.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Optional, Sequence

from .models import PredictedQuestion

MATCH_THRESHOLD = 0.72

# Question words (what, why, how…) are NOT stopwords: "what is X" and
# "why use X" need different answers.
STOPWORDS = set(
    "a an the is are was were be been being am do does did of to in on at for with by from and or but it its this "
    "that these those there can could would should will shall may might must you your we our i me my us they them "
    "their please tell explain about some any just so also really actually basically mean means like kind sort "
    "into as if then than have has had get got".split()
)


def _stem(word: str) -> str:
    if len(word) > 5 and word.endswith("ing"):
        return word[:-3]
    if len(word) > 4 and word.endswith("ed"):
        return word[:-2]
    if len(word) > 4 and word.endswith("es"):
        return word[:-2]
    if len(word) > 3 and word.endswith("s") and not word.endswith("ss"):
        return word[:-1]
    return word


def content_tokens(text: str) -> set[str]:
    return {_stem(w) for w in re.findall(r"\w+", text.lower()) if w not in STOPWORDS}


def similarity(a: str, b: str) -> float:
    ta, tb = content_tokens(a), content_tokens(b)
    if not ta or not tb:
        return 0.0
    shared = len(ta & tb)
    # One shared word between two longer questions is coincidence, not a match.
    if shared < 2 and min(len(ta), len(tb)) > 2:
        return 0.0
    return shared / math.sqrt(len(ta) * len(tb))


@dataclass
class Match:
    item: PredictedQuestion
    score: float


def find_best_match(
    question: str, items: Sequence[PredictedQuestion], threshold: float = MATCH_THRESHOLD
) -> Optional[Match]:
    best: Optional[Match] = None
    for item in items:
        score = similarity(question, item.question)
        if best is None or score > best.score:
            best = Match(item, score)
    return best if best and best.score >= threshold else None
