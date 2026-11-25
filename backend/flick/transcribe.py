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
from typing import TYPE_CHECKING, Optional

if TYPE_CHECKING:
    import numpy as np

#: Whisper sizes offered in Settings. 'small' balances speed and accuracy;
#: 'medium' is better for Urdu but slower.
SIZES = ("base", "small", "medium")


class TranscriberUnavailable(RuntimeError):
    """faster-whisper is not installed, or its model could not be loaded."""


class AudioUnreadable(ValueError):
    """The recording could not be decoded (empty, cut off, or an unknown format)."""


SAMPLE_RATE = 16_000


def decode_audio(audio: bytes) -> "np.ndarray":
    """
    Any recording (webm/opus from the mic, wav, mp3, m4a) → 16 kHz mono float32 samples.

    We decode it ourselves instead of letting faster-whisper do it: faster-whisper 1.2 passes
    an option that PyAV 15+ removed, which made every voice question fail.
    """
    import av
    import numpy as np

    if not audio:
        raise AudioUnreadable("The recording is empty.")
    try:
        with av.open(io.BytesIO(audio), mode="r") as container:
            stream = next((s for s in container.streams if s.type == "audio"), None)
            if stream is None:
                raise AudioUnreadable("The recording has no sound in it.")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=SAMPLE_RATE)
            chunks = []
            for frame in container.decode(stream):
                for out in resampler.resample(frame):
                    chunks.append(out.to_ndarray().reshape(-1))
            for out in resampler.resample(None):  # flush
                chunks.append(out.to_ndarray().reshape(-1))
    except AudioUnreadable:
        raise
    except Exception as err:  # av.error.* (cut-off or unknown file)
        raise AudioUnreadable(f"Could not read the recording: {err}") from err
    if not chunks:
        raise AudioUnreadable("The recording is empty.")
    return (np.concatenate(chunks).astype(np.float32) / 32768.0).astype(np.float32)


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
        samples = decode_audio(audio)
        if len(samples) < SAMPLE_RATE * 0.3:  # under 0.3 s: nothing was said
            return "", int((time.perf_counter() - started) * 1000)
        segments, _info = self._model.transcribe(
            samples,
            language=None if language == "auto" else language,
            beam_size=1,  # greedy decoding: much faster, near-identical for short questions
            vad_filter=True,  # skip leading/trailing silence
            condition_on_previous_text=False,
            without_timestamps=True,
            initial_prompt=(f"Flick. {hint}"[:400] if hint else None),
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        return text, int((time.perf_counter() - started) * 1000)
