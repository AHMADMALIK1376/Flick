"""Flick's local HTTP + WebSocket API, used by the desktop app's windows.

Listens on 127.0.0.1 only. Every request must carry the per-launch token
(header `X-Flick-Token`, or `?token=` for the WebSocket). Web pages in a
browser cannot add that header without the token, so a website cannot drive
Flick or read its settings.
"""

from __future__ import annotations

import asyncio
import hmac
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Callable, Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import __version__
from .models import MODELS, Answer, Deck, DeckSummary, Settings, SettingsUpdate
from .pptx_reader import PptxError
from .service import FlickService, UserError
from .text import SlideTarget

#: Largest .pptx accepted by upload.
MAX_UPLOAD_BYTES = 200 * 1024 * 1024


class AskRequest(BaseModel):
    text: str


class ExplainRequest(BaseModel):
    slide: Optional[int] = None  # None = the slide on screen


class PathRequest(BaseModel):
    path: str


class PublicSettings(Settings):
    """Settings as sent to the windows: the key is masked, never returned."""

    has_api_key: bool = False


def create_app(service: FlickService, token: str, on_ready: Optional[Callable[[], None]] = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        if on_ready:
            on_ready()
        yield

    app = FastAPI(title="Flick backend", version=__version__, lifespan=lifespan)
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

    @app.get("/models", dependencies=auth)
    def models() -> list[dict]:
        return MODELS

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

    # ── Live ────────────────────────────────────────────────────────────────

    @app.post("/question-starting", dependencies=auth, status_code=204)
    def question_starting():
        service.question_starting()

    @app.post("/ask", dependencies=auth, response_model=Optional[Answer])
    async def ask(req: AskRequest):
        return await service.ask(req.text)

    @app.post("/explain", dependencies=auth, response_model=Answer)
    async def explain(req: ExplainRequest):
        if req.slide is not None and req.slide > 0:
            return await service.explain_slide(SlideTarget("number", number=req.slide))
        return await service.explain_slide()

    @app.get("/log", dependencies=auth, response_model=list[Answer])
    def log(limit: int = Query(default=300, ge=1, le=1000)):
        return service.db.get_log(limit=limit)

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


def _summary(service: FlickService, deck_id: str) -> DeckSummary:
    return next(d for d in service.db.list_decks() if d.id == deck_id)


def _mask(key: str) -> str:
    return "" if not key else "•" * 8 + key[-4:]
