"""Starts the Flick backend: `python -m flick --port 8765`.

The desktop app starts this process, passes a random token in FLICK_TOKEN and
waits for the `FLICK_READY <port>` line on stdout before connecting.
"""

from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path

import uvicorn

from .api import create_app
from .db import Database
from .events import EventBus
from .llm import Claude
from .powerpoint import PowerPointBridge
from .semantic import LocalEmbedder
from .service import FlickService
from .transcribe import Transcriber
from .voice import KokoroVoice, Speaker


def default_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "Flick"


def _voice_for(settings) -> tuple[str, float]:
    """English talks use the English voice; Urdu and Urdu + English talks use the Urdu voice."""
    voice = settings.urdu_voice if settings.talk_language != "en" else settings.voice_name
    return voice, settings.voice_speed


def build_service(data_dir: Path) -> FlickService:
    data_dir.mkdir(parents=True, exist_ok=True)
    db = Database(data_dir / "flick.db")
    llm = Claude(
        get_key=lambda: db.get_settings().anthropic_api_key,
        get_model=lambda: db.get_settings().model,
    )
    models = data_dir / "models"  # downloaded once, on first run
    speaker = Speaker(
        KokoroVoice(models / "voice"),
        cache_dir=data_dir / "voice-cache",
        settings=lambda: _voice_for(db.get_settings()),
    )
    return FlickService(
        db,
        llm,
        PowerPointBridge(),
        EventBus(),
        embedder=LocalEmbedder(models / "meaning"),
        transcriber=Transcriber(models / "whisper"),
        speaker=speaker,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Flick backend")
    parser.add_argument("--port", type=int, default=int(os.environ.get("FLICK_PORT", 8765)))
    parser.add_argument("--data-dir", type=Path, default=Path(os.environ.get("FLICK_DATA_DIR", default_data_dir())))
    args = parser.parse_args()

    token = os.environ.get("FLICK_TOKEN")
    if not token:
        token = secrets.token_urlsafe(24)
        print(f"No FLICK_TOKEN set; using this one for this run: {token}", flush=True)

    app = create_app(
        build_service(args.data_dir), token, on_ready=lambda: print(f"FLICK_READY {args.port}", flush=True)
    )

    # 127.0.0.1 only: Flick is never reachable from the network.
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
