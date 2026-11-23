"""Speech to text on the computer, with faster-whisper.

faster-whisper runs Whisper through CTranslate2 with 8-bit weights: several
times faster than the original on a laptop CPU, with the same accuracy. The
model is loaded once at startup (downloaded on first run) so the first
question does not wait for it.
"""

from __future__ import annotations

import io
import threading
import time
from pathlib import Path
from typing import Optional

#: Whisper sizes offered in Settings. 'small' balances speed and accuracy;
#: 'medium' is better for Urdu but slower.
SIZES = ("base", "small", "medium")


class TranscriberUnavailable(RuntimeError):
    """faster-whisper is not installed, or its model could not be loaded."""


class Transcriber:
    def __init__(self, model_dir: Optional[Path] = None):
        self._model_dir = str(model_dir) if model_dir else None
        self._model = None
        self._size: Optional[str] = None
        self._lock = threading.Lock()
        self.error: Optional[str] = None

    def ready(self, size: str) -> bool:
        return self._model is not None and self._size == size

    def load(self, size: str) -> None:
        """Blocking (downloads on first run). Call from a worker thread."""
        size = size if size in SIZES else "small"
        with self._lock:
            if self._model is not None and self._size == size:
                return
            try:
                from faster_whisper import WhisperModel
            except ImportError:
                self.error = "faster-whisper is not installed."
                return
            try:
                self._model = WhisperModel(size, device="cpu", compute_type="int8", download_root=self._model_dir)
                self._size = size
                self.error = None
            except Exception as err:
                self.error = f"Could not load the speech model: {err}"

    def transcribe(self, audio: bytes, size: str, language: str, hint: str = "") -> tuple[str, int]:
        """
        Returns (text, milliseconds). `language`: 'en', 'ur' or 'auto'.
        `hint`: words likely to be spoken (slide titles), so names like
        "SafeQuery" or "PostgreSQL" are spelled right.
        """
        started = time.perf_counter()
        self.load(size)
        if self._model is None:
            raise TranscriberUnavailable(self.error or "The speech model is not available.")
        segments, _info = self._model.transcribe(
            io.BytesIO(audio),
            language=None if language == "auto" else language,
            beam_size=1,  # greedy decoding: much faster, near-identical for short questions
            vad_filter=True,  # skip leading/trailing silence
            condition_on_previous_text=False,
            without_timestamps=True,
            initial_prompt=(f"Flick. {hint}"[:400] if hint else None),
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        return text, int((time.perf_counter() - started) * 1000)
