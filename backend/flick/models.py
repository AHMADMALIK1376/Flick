"""Data shapes shared by the database, the AI logic and the API."""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

PrepStatus = Literal["idle", "preparing", "ready", "error"]

# Where an answer came from. Shown on the answer card so the presenter knows
# how far to trust it before repeating it.
AnswerOrigin = Literal[
    "prepared",  # matched a question predicted before the talk
    "slides",  # answered from the deck
    "web",  # the deck did not cover it, so Claude searched the web
    "general",  # no deck loaded and no search needed
    "explain",  # the presenter asked Flick to explain a slide to the audience
    "greeting",  # only "Flick" was said
    "error",
    "example",  # Flick drew an example / a story on the whiteboard
]


class Slide(BaseModel):
    number: int  # 1-based, in presentation order
    title: str = ""
    body: str = ""  # one line per paragraph, title excluded
    notes: str = ""  # speaker notes


class PredictedQuestion(BaseModel):
    id: str
    slide: int  # 0 = about the talk as a whole
    question: str
    answer: str


class Deck(BaseModel):
    id: str
    name: str
    file_path: str
    loaded_at: float
    prep_status: PrepStatus = "idle"
    prep_error: Optional[str] = None
    slides: list[Slide] = Field(default_factory=list)
    predicted: list[PredictedQuestion] = Field(default_factory=list)


class DeckSummary(BaseModel):
    """`explanation_count`: slides with an explanation ready (instant "explain this slide")."""

    id: str
    name: str
    loaded_at: float
    slide_count: int
    question_count: int
    explanation_count: int = 0
    prep_status: PrepStatus
    prep_error: Optional[str] = None
    active: bool


class WebSource(BaseModel):
    title: str
    url: str


class Answer(BaseModel):
    id: str
    question: str
    answer: str
    origin: AnswerOrigin
    sources: list[WebSource] = Field(default_factory=list)
    current_slide: Optional[int] = None
    duration_ms: int = 0
    timestamp: float
    speak: bool  # whether this answer should be read aloud now
    # True when the text was already sent sentence by sentence ("answer_delta"
    # events) and spoken as it arrived: don't speak the final text again.
    streamed: bool = False
    # True when Flick's natural voice (played by the backend) says it: the screens stay quiet.
    voiced: bool = False


class PrepProgress(BaseModel):
    deck_id: str
    status: PrepStatus
    done: int = 0
    total: int = 0
    message: Optional[str] = None


class Settings(BaseModel):
    """Everything the user sets. The API key never leaves this computer except to Anthropic."""

    anthropic_api_key: str = ""
    model: str = "claude-haiku-5-5"
    # 'speak': answers are read aloud to the room. 'private': only shown to the
    # presenter (slide explanations are always spoken).
    answer_mode: Literal["speak", "private"] = "speak"
    ask_hotkey: str = "Ctrl+Shift+Space"
    explain_hotkey: str = "Ctrl+Shift+E"
    hotkey_mode: Literal["toggle", "push-to-talk"] = "toggle"
    speech_model: str = "small"
    language: str = "en"
    show_mic: bool = True
    # 'natural': Flick's offline neural voice (needed for "present for me"). 'windows': the Windows voice.
    voice: Literal["natural", "windows"] = "natural"
    voice_name: str = "af_heart"
    voice_speed: float = Field(default=1.0, ge=0.7, le=1.4)


class SettingsUpdate(BaseModel):
    """A partial settings change: only the fields sent are updated."""

    anthropic_api_key: Optional[str] = None
    model: Optional[str] = None
    answer_mode: Optional[Literal["speak", "private"]] = None
    ask_hotkey: Optional[str] = None
    explain_hotkey: Optional[str] = None
    hotkey_mode: Optional[Literal["toggle", "push-to-talk"]] = None
    speech_model: Optional[str] = None
    language: Optional[str] = None
    show_mic: Optional[bool] = None
    voice: Optional[Literal["natural", "windows"]] = None
    voice_name: Optional[str] = None
    voice_speed: Optional[float] = Field(default=None, ge=0.7, le=1.4)


# Models offered in the sidebar and in Settings. Haiku first: live answers are latency-bound.
# "price": USD per million input / output tokens (Claude list prices, see usage.PRICES).
MODELS = [
    {"id": "claude-haiku-5-5", "name": "Claude Haiku 5.5", "short": "Haiku 5.5",
     "hint": "Fastest and cheapest. Best for live talks.", "price": "$0.10 / $0.50"},
    {"id": "claude-sonnet-5-5", "name": "Claude Sonnet 5.5", "short": "Sonnet 5.5",
     "hint": "Smarter answers and drawings, a bit slower.", "price": "$2 / $10"},
    {"id": "claude-opus-5-5", "name": "Claude Opus 5.5", "short": "Opus 5.5",
     "hint": "The best answers. Slowest and most expensive.", "price": "$4 / $20"},
]
