"""Flick's local HTTP + WebSocket API, used by the desktop app's windows.

Listens on 127.0.0.1 only. Every request must carry the per-launch token
(header `X-Flick-Token`, or `?token=` for the WebSocket). Web pages in a
browser cannot add that header without the token, so a website cannot drive
Flick or read its settings.
"""

from __future__ import annotations

import asyncio
import csv
import hmac
import io
from datetime import datetime
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

from . import __version__
from .llm import LLMError
from .models import MODELS, Answer, Deck, DeckSummary, PredictedQuestion, Settings, SettingsUpdate
from .pptx_reader import PptxError
from .service import FlickService, UserError
from .transcribe import TranscriberUnavailable
from .voice import VOICES
from .text import SlideTarget

#: Largest .pptx accepted by upload.
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
#: Largest recording accepted (about 10 minutes of 16 kHz mono WAV).
MAX_AUDIO_BYTES = 20 * 1024 * 1024


class UTF8JSONResponse(JSONResponse):
    # Say UTF-8 explicitly: Windows PowerShell 5.1 otherwise decodes JSON as
    # Latin-1 and shows "–" in "SafeQuery – Project.pptx" as "â".
    media_type = "application/json; charset=utf-8"


class AskRequest(BaseModel):
    text: str


class ExplainRequest(BaseModel):
    slide: Optional[int] = None  # None = the slide on screen


class PresentRequest(BaseModel):
    from_slide: Optional[int] = None  # None = from the first slide


class PathRequest(BaseModel):
    path: str


class QuestionCreate(BaseModel):
    slide: int = 0  # 0 = about the whole talk
    question: str
    answer: str


class QuestionUpdate(BaseModel):
    slide: Optional[int] = None
    question: Optional[str] = None
    answer: Optional[str] = None


class PublicSettings(Settings):
    """Settings as sent to the windows: the key is masked, never returned."""

    has_api_key: bool = False


def create_app(service: FlickService, token: str, on_ready: Optional[Callable[[], None]] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if on_ready:
            on_ready()
        # Load the speech and meaning models and open the Claude connection
        # now, in the background, so the first question doesn't wait for them.
        service._background(service.warm_up())
        yield
        if service.speaker:
            service.presenter.stop()
            service.speaker.close()

    app = FastAPI(title="Flick backend", version=__version__, lifespan=lifespan, default_response_class=UTF8JSONResponse)
    # Renderer pages load from file:// (origin "null") or the Vite dev server.
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

    def check_token(x_flick_token: str = Header(default="")) -> None:
        if not hmac.compare_digest(x_flick_token, token):
            raise HTTPException(status_code=401, detail="Missing or wrong Flick token.")

    auth = [Depends(check_token)]

    def public_settings() -> PublicSettings:
        s = service.db.get_settings()
        data = s.model_dump()
        key = data.pop("anthropic_api_key")
        return PublicSettings(**data, anthropic_api_key=_mask(key), has_api_key=bool(key))

    def user_error(err: Exception) -> HTTPException:
        return HTTPException(status_code=400, detail=str(err))

    # ── Health & settings ───────────────────────────────────────────────────

    @app.get("/health")
    def health() -> dict:
        return {"ok": True, "version": __version__}

    @app.get("/settings", dependencies=auth, response_model=PublicSettings)
    def get_settings():
        return public_settings()

    @app.patch("/settings", dependencies=auth, response_model=PublicSettings)
    def update_settings(update: SettingsUpdate):
        changes = update.model_dump(exclude_none=True)
        # The windows get the key back masked; sending the mask back must not overwrite it.
        if "anthropic_api_key" in changes and "•" in changes["anthropic_api_key"]:
            del changes["anthropic_api_key"]
        if "model" in changes and changes["model"] not in {m["id"] for m in MODELS}:
            raise HTTPException(status_code=400, detail="Unknown model.")
        service.db.update_settings(changes)
        return public_settings()

    @app.get("/status", dependencies=auth)
    def status() -> dict:
        """Which speed features are ready (models load in the background after startup)."""
        settings = service.db.get_settings()
        t, e = service.transcriber, service.embedder
        return {
            "speech_model": {"ready": bool(t and t.ready(settings.speech_model)), "error": getattr(t, "error", None)},
            "meaning_model": {"ready": bool(e and e.ready()), "error": getattr(e, "error", None)},
            "powerpoint": service.bridge.supported,
            "has_api_key": bool(settings.anthropic_api_key),
            "voice": service.voice_status(),
        }

    @app.get("/models", dependencies=auth)
    def models() -> list[dict]:
        return MODELS

    @app.post("/settings/test-key", dependencies=auth)
    async def test_key() -> dict:
        """Does the saved Claude key work? Never returns or logs the key itself."""
        try:
            await service.llm.check_key()
        except LLMError as err:
            return {"ok": False, "reason": err.kind}
        return {"ok": True}

    # ── Decks ───────────────────────────────────────────────────────────────

    @app.get("/decks", dependencies=auth, response_model=list[DeckSummary])
    def list_decks():
        return service.db.list_decks()

    @app.get("/decks/active", dependencies=auth, response_model=Optional[Deck])
    def active_deck():
        return service.active_deck()

    @app.get("/decks/{deck_id}", dependencies=auth, response_model=Deck)
    def get_deck(deck_id: str):
        deck = service.db.get_deck(deck_id)
        if deck is None:
            raise HTTPException(status_code=404, detail="No such presentation.")
        return deck

    @app.post("/decks/from-path", dependencies=auth, response_model=DeckSummary)
    async def load_from_path(req: PathRequest):
        try:
            deck = await service.load_deck(req.path)
        except (UserError, PptxError) as err:
            raise user_error(err)
        return _summary(service, deck.id)

    @app.post("/decks/upload", dependencies=auth, response_model=DeckSummary)
    async def upload(file: UploadFile = File(...), path: str = Form(default="")):
        data = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="That file is too large (over 200 MB).")
        try:
            deck = await service.load_deck(path or f"upload/{Path(file.filename or 'deck.pptx').name}", data=data)
        except (UserError, PptxError) as err:
            raise user_error(err)
        return _summary(service, deck.id)

    @app.post("/decks/from-powerpoint", dependencies=auth, response_model=DeckSummary)
    async def load_from_powerpoint():
        try:
            deck = await service.load_deck_from_powerpoint()
        except (UserError, PptxError) as err:
            raise user_error(err)
        return _summary(service, deck.id)

    @app.post("/decks/{deck_id}/activate", dependencies=auth, response_model=list[DeckSummary])
    def activate(deck_id: str):
        if not service.db.activate_deck(deck_id):
            raise HTTPException(status_code=404, detail="No such presentation.")
        return service.db.list_decks()

    @app.post("/decks/{deck_id}/prepare", dependencies=auth, status_code=202)
    async def prepare(deck_id: str):
        if service.db.get_deck(deck_id) is None:
            raise HTTPException(status_code=404, detail="No such presentation.")
        service._background(service.prepare_deck(deck_id))
        return {"started": True}

    @app.delete("/decks/{deck_id}", dependencies=auth, response_model=list[DeckSummary])
    def delete(deck_id: str):
        service.db.delete_deck(deck_id)
        return service.db.list_decks()

    # ── Prepared questions (users can fix what Flick predicted) ─────────────

    def check_question(deck: Deck, slide: Optional[int], question: Optional[str], answer: Optional[str]) -> None:
        if question is not None and not question.strip() or answer is not None and not answer.strip():
            raise HTTPException(status_code=400, detail="Write a question and an answer.")
        if slide is not None and not 0 <= slide <= len(deck.slides):
            raise HTTPException(status_code=400, detail="That slide is not in this presentation.")

    @app.post("/decks/{deck_id}/questions", dependencies=auth, status_code=201, response_model=PredictedQuestion)
    def add_question(deck_id: str, req: QuestionCreate):
        deck = service.db.get_deck(deck_id)
        if deck is None:
            raise HTTPException(status_code=404, detail="No such presentation.")
        check_question(deck, req.slide, req.question, req.answer)
        return service.db.add_question(deck_id, req.slide, req.question.strip(), req.answer.strip())

    @app.patch("/questions/{question_id}", dependencies=auth, response_model=PredictedQuestion)
    def edit_question(question_id: str, req: QuestionUpdate):
        deck_id = service.db.question_deck_id(question_id)
        deck = service.db.get_deck(deck_id) if deck_id else None
        if deck is None:
            raise HTTPException(status_code=404, detail="No such question.")
        check_question(deck, req.slide, req.question, req.answer)
        updated = service.db.update_question(
            question_id,
            question=req.question.strip() if req.question is not None else None,
            answer=req.answer.strip() if req.answer is not None else None,
            slide=req.slide,
        )
        if updated is None:
            raise HTTPException(status_code=404, detail="No such question.")
        return updated

    @app.delete("/questions/{question_id}", dependencies=auth, status_code=204)
    def delete_question(question_id: str):
        if not service.db.delete_question(question_id):
            raise HTTPException(status_code=404, detail="No such question.")

    # ── Presenting: Flick gives the whole talk ───────────────────────────────

    @app.get("/present", dependencies=auth)
    async def present_status() -> dict:
        return service.presenter.status()

    @app.post("/present/start", dependencies=auth)
    async def present_start(req: PresentRequest) -> dict:
        try:
            return service.start_presenting(req.from_slide)
        except UserError as err:
            raise user_error(err)

    @app.post("/present/pause", dependencies=auth)
    async def present_pause() -> dict:
        service.presenter.pause("manual")
        return service.presenter.status()

    @app.post("/present/resume", dependencies=auth)
    async def present_resume() -> dict:
        service.presenter.resume()
        return service.presenter.status()

    @app.post("/present/next", dependencies=auth)
    async def present_next() -> dict:
        service.presenter.go(1)
        return service.presenter.status()

    @app.post("/present/previous", dependencies=auth)
    async def present_previous() -> dict:
        service.presenter.go(-1)
        return service.presenter.status()

    @app.post("/present/stop", dependencies=auth)
    async def present_stop() -> dict:
        service.presenter.stop()
        return service.presenter.status()

    # ── Voice ───────────────────────────────────────────────────────────────

    @app.get("/voices", dependencies=auth)
    def voices() -> list[dict]:
        return [{"id": v, "name": name} for v, name in VOICES]

    @app.post("/voice/test", dependencies=auth, status_code=204)
    async def voice_test():
        """Says one sample sentence in the chosen voice."""
        if not service.speaker or not service.speaker.available():
            status = service.voice_status()
            raise HTTPException(status_code=400, detail=status["error"] or "Flick's voice is still getting ready. Try again in a minute.")
        service.speaker.stop()
        service.speaker.say("Hi, I'm Flick. This is how I will sound in your class.")

    # ── Live ────────────────────────────────────────────────────────────────

    @app.post("/question-starting", dependencies=auth, status_code=204)
    async def question_starting():
        # async: while presenting this pauses the talk, which needs the event loop.
        service.question_starting()

    @app.post("/ask", dependencies=auth, response_model=Optional[Answer])
    async def ask(req: AskRequest):
        return await service.ask(req.text)

    @app.post("/explain", dependencies=auth, response_model=Answer)
    async def explain(req: ExplainRequest):
        if req.slide is not None and req.slide > 0:
            return await service.explain_slide(SlideTarget("number", number=req.slide))
        return await service.explain_slide()

    @app.post("/transcribe", dependencies=auth)
    async def transcribe(audio: UploadFile = File(...)) -> dict:
        """Speech → text (WAV, MP3, WebM…). For showing the words before answering."""
        data = await _read_audio(audio)
        try:
            text, ms = await service.transcribe(data)
        except (UserError, TranscriberUnavailable) as err:
            raise HTTPException(status_code=503, detail=str(err))
        return {"text": text, "duration_ms": ms}

    @app.post("/ask-audio", dependencies=auth)
    async def ask_audio(audio: UploadFile = File(...)) -> dict:
        """Speech → text → answer in one request: one round trip less than /transcribe + /ask."""
        data = await _read_audio(audio)
        try:
            text, ms = await service.transcribe(data)
        except (UserError, TranscriberUnavailable) as err:
            raise HTTPException(status_code=503, detail=str(err))
        answer = await service.ask(text)
        return {"transcript": text, "transcribe_ms": ms, "answer": answer.model_dump() if answer else None}

    @app.get("/log", dependencies=auth, response_model=list[Answer])
    def log(limit: int = Query(default=300, ge=1, le=1000)):
        return service.db.get_log(limit=limit)

    @app.get("/log/export")
    def export_log(
        token_param: str = Query(default="", alias="token"),
        x_flick_token: str = Header(default=""),
    ):
        """The Q&A log as a CSV file. A download link can't send headers, so ?token= also works."""
        if not (hmac.compare_digest(token_param, token) or hmac.compare_digest(x_flick_token, token)):
            raise HTTPException(status_code=401, detail="Wrong or missing token.")
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(["Time", "Question", "Answer", "Source", "Slide", "Duration (ms)", "Web sources"])
        for a in reversed(service.db.get_log(limit=1000)):  # oldest first
            if a.origin == "greeting":
                continue
            writer.writerow([
                datetime.fromtimestamp(a.timestamp).strftime("%Y-%m-%d %H:%M"),
                a.question,
                a.answer,
                ORIGIN_NAMES.get(a.origin, a.origin),
                a.current_slide if a.current_slide is not None else "",
                a.duration_ms,
                " | ".join(f"{s.title} ({s.url})" for s in a.sources),
            ])
        # The BOM makes Excel read the file as UTF-8, so Urdu shows correctly.
        return Response(
            content="\ufeff" + out.getvalue(),
            media_type="text/csv; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="flick-qa-log.csv"'},
        )

    @app.delete("/log", dependencies=auth, status_code=204)
    def clear_log():
        service.db.clear_log()

    @app.websocket("/events")
    async def events(ws: WebSocket, token_param: str = Query(default="", alias="token")):
        if not hmac.compare_digest(token_param, token):
            await ws.close(code=4401)
            return
        await ws.accept()
        queue = service.events.subscribe()
        try:
            while True:
                await ws.send_json(await queue.get())
        except (WebSocketDisconnect, asyncio.CancelledError, RuntimeError):
            pass
        finally:
            service.events.unsubscribe(queue)

    return app


async def _read_audio(audio: UploadFile) -> bytes:
    data = await audio.read(MAX_AUDIO_BYTES + 1)
    if len(data) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="That recording is too long.")
    if not data:
        raise HTTPException(status_code=400, detail="The recording is empty.")
    return data


ORIGIN_NAMES = {
    "prepared": "Prepared answer",
    "slides": "From your slides",
    "web": "From the web",
    "general": "General knowledge",
    "explain": "Slide explanation",
    "error": "Problem",
}


def _summary(service: FlickService, deck_id: str) -> DeckSummary:
    return next(d for d in service.db.list_decks() if d.id == deck_id)


def _mask(key: str) -> str:
    return "" if not key else "•" * 8 + key[-4:]
