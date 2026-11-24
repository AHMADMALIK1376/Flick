"""Turns a raw transcript into the question to answer, and spots slide commands.

The presenter usually addresses Flick by name ("Flick, what is
backpropagation?"), and Whisper often writes the name as "flix" or "flik".
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional

ADDRESS = re.compile(
    r"^\s*(?:(?:hey|hi|hello|ok|okay|yo)[\s,]+)?(?:flick|flik|flix|flicks|flick's)\b[\s,.:;!?-]*", re.IGNORECASE
)

#: Whisper's usual outputs for silence or a cough: "nothing was heard", not a question.
SILENCE = {"", "you", "thank you", "thanks", "thank you for watching", "thanks for watching", "bye",
           "blank audio", "music", "silence"}


def clean_question(transcript: str) -> str:
    q = " ".join(ADDRESS.sub("", transcript).split())
    # Removing "Flick," leaves a lowercase start; the card reads better capitalised.
    return q[:1].upper() + q[1:]


def is_bare_address(transcript: str) -> bool:
    """True when the presenter said Flick's name and nothing else."""
    return bool(ADDRESS.match(transcript)) and not re.sub(r"[\W_]", "", clean_question(transcript))


def is_nothing_heard(transcript: str) -> bool:
    normalized = re.sub(r"[\[\]().,!?'\"_-]", " ", transcript.lower())
    return " ".join(normalized.split()) in SILENCE


# ── "Explain this slide" ────────────────────────────────────────────────────

@dataclass(frozen=True)
class SlideTarget:
    kind: str  # 'current' | 'number' | 'relative'
    number: int = 0  # for 'number'
    offset: int = 0  # for 'relative': +1 next, -1 previous


#: Longest request still treated as a command, in words.
MAX_COMMAND_WORDS = 14

SLIDE_WORD = re.compile(r"\bslides?\b|سلائیڈ|سلائڈ")
EXPLAIN_VERB = re.compile(
    r"\b(explain|describe|summari[sz]e|walk\b.{0,20}\bthrough|go (over|through)|run through|"
    r"talk\b.{0,20}\b(through|about)|teach|break down|elaborate( on)?|samjh\w*|bata\w*|explain kar\w*)\b|سمجھا|بتا"
)
#: Asking for a reason is a question about the slide, not a request to present it.
QUESTION_WORDS = re.compile(r"\b(why|how come|kyun|kyon|kiyon)\b|کیوں")
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
    "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "first": 1, "second": 2, "third": 3,
    "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10,
}


def parse_slide_command(text: str) -> Optional[SlideTarget]:
    """
    "explain this slide" → current; "explain slide 5" → number 5;
    "explain the next slide" → relative +1. Also Roman Urdu and Urdu.

    A question that merely mentions a slide ("why does slide 3 say…?") is
    NOT a command. The test is strict on purpose: explaining a slide aloud
    when the presenter asked something else would talk over them.
    """
    t = " ".join(re.sub(r"[“”\"'`’،,.!?؟۔:;()\-]", " ", text.lower()).split())
    if not SLIDE_WORD.search(t) or not EXPLAIN_VERB.search(t) or QUESTION_WORDS.search(t):
        return None
    if len(t.split()) > MAX_COMMAND_WORDS:
        return None
    if re.search(r"\b(next|agli|agla)\b.{0,12}\bslide|اگلی", t):
        return SlideTarget("relative", offset=1)
    if re.search(r"\b(previous|last|pichli|pichla)\b.{0,12}\bslide|پچھلی", t):
        return SlideTarget("relative", offset=-1)

    digits = re.search(r"\bslides?\s*(?:number\s*|no\s*|#\s*)?(\d{1,3})\b", t) or re.search(
        r"\b(\d{1,3})(?:st|nd|rd|th)?\s+slide\b", t
    )
    if digits and int(digits.group(1)) > 0:
        return SlideTarget("number", number=int(digits.group(1)))
    word = re.search(r"\bslides?\s*(?:number\s*)?([a-z]+)\b", t) or re.search(r"\b([a-z]+)\s+slide\b", t)
    if word and word.group(1) in NUMBER_WORDS:
        return SlideTarget("number", number=NUMBER_WORDS[word.group(1)])
    return SlideTarget("current")


#: Words a plain "explain this slide" request is made of. Anything else ("in
#: simple words", "in Urdu", "focus on the table") asks for something the
#: explanation written before the talk does not have, so it is written live.
_PLAIN_WORDS = set(
    "flick hey hi ok okay please can could would you now explain describe walk talk go run through over us them "
    "everyone audience class the this that current our a an to for of on screen slide slides number next previous "
    "last showing shown".split()
) | set(NUMBER_WORDS)


def is_plain_explain_request(text: str) -> bool:
    words = re.sub(r"[“”\"'`’،,.!?؟۔:;()\-]", " ", text.lower()).split()
    return all(w in _PLAIN_WORDS or re.fullmatch(r"\d{1,3}(st|nd|rd|th)?", w) for w in words)


# ── "Flick, present this for me" ────────────────────────────────────────────

PresentCommand = str  # 'start' | 'stop' | 'continue' | 'next' | 'previous'

_PRESENT_START = re.compile(
    r"\b(present|give|start|begin|run|deliver|do)\b.{0,25}\b(presentation|talk|lecture|deck|slides|class)\b"
    r"|\bpresent\b.{0,12}\b(this|it|for me|for us|everything|the whole)\b"
    r"|\b(presentation|lecture|class)\b.{0,15}\b(do|karo|kar do|dein|de do|shuru)\b"
    r"|\b(take|teach)\b.{0,10}\b(the class|this class|class)\b"
)
_PRESENT_STOP = re.compile(r"\b(stop|end|finish|pause)\b.{0,15}\b(present\w*|talk|lecture)\b|\bstop presenting\b")
_PRESENT_CONTINUE = re.compile(r"^(please )?(continue|carry on|go on|resume|keep going|go ahead)( please)?$|^(jari|chalo|aage) ")
_PRESENT_NEXT = re.compile(r"^(go to |move to |show )?(the )?(next|agli|agla) slide( please)?$")
_PRESENT_PREVIOUS = re.compile(r"^(go (back )?to |move to |show )?(the )?(previous|last|pichli|pichla) slide( please)?$|^go back$")

#: Longer than this, it is a question, not a command.
MAX_PRESENT_WORDS = 10


def parse_present_command(text: str, presenting: bool) -> Optional[PresentCommand]:
    """
    "Flick, present this for me" → start. While presenting: "stop presenting",
    "continue", "next slide", "previous slide". Questions are never commands.
    """
    t = " ".join(re.sub(r"[“”\"'`’،,.!?؟۔:;()\-]", " ", text.lower()).split())
    t = re.sub(r"^(hey |ok |okay )?flick\s*", "", t).strip()
    if not t or len(t.split()) > MAX_PRESENT_WORDS or QUESTION_WORDS.search(t) or re.match(r"^(what|how|who|when|where|which|can you explain|is|are|does|do you)\b", t):
        return None
    if _PRESENT_STOP.search(t):
        return "stop" if presenting else None
    if presenting:
        if _PRESENT_CONTINUE.search(t):
            return "continue"
        if _PRESENT_NEXT.search(t):
            return "next"
        if _PRESENT_PREVIOUS.search(t):
            return "previous"
    return "start" if _PRESENT_START.search(t) else None
