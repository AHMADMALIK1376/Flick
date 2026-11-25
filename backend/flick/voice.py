"""Flick's natural voice: Kokoro, an offline neural text-to-speech model.

- Runs on this computer (no API key, no internet after the first download).
- The model (~330 MB) downloads once, in the background, on first start.
- Audio is made one sentence ahead of what is playing, and cached on disk, so slide
  explanations prepared before the talk play instantly.
- Playback happens here in the backend, so Flick knows exactly when a sentence
  has been said: that is what lets it present a whole deck and pause for questions.
"""

from __future__ import annotations

import asyncio
import hashlib
import re
import shutil
import subprocess
import sys
import threading
import urllib.request
import wave
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional, Protocol

import numpy as np

_RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
MODEL_FILES = {"kokoro-v1.0.onnx": _RELEASE + "kokoro-v1.0.onnx", "voices-v1.0.bin": _RELEASE + "voices-v1.0.bin"}

#: Voices offered in Settings: (id, label). US voices use American English, UK voices British.
VOICES = [
    ("af_heart", "Heart (US, female)"),
    ("am_michael", "Michael (US, male)"),
    ("bf_emma", "Emma (UK, female)"),
    ("bm_george", "George (UK, male)"),
]
DEFAULT_VOICE = "af_heart"

#: Voices for Urdu and for Urdu + English (Kokoro's Hindi voices: spoken Urdu and Hindi sound the
#: same; the words are read with Urdu pronunciation rules, English words with English ones).
URDU_VOICES = [
    ("hf_alpha", "Alpha (female)"),
    ("hf_beta", "Beta (female)"),
    ("hm_omega", "Omega (male)"),
    ("hm_psi", "Psi (male)"),
]
DEFAULT_URDU_VOICE = "hf_alpha"

_URDU = r"؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿"
# Kokoro says English (Latin letters) and Urdu (Urdu script, with English words mixed in).
_SPEAKABLE = re.compile(r"^[\x00-\x7F -ɏ‐-›€" + _URDU + r"]*$")
_URDU_LETTER = re.compile("[" + _URDU + "]")
_SENTENCE_END = re.compile(
    r"(?<=[.!?])\s+(?=[A-Z0-9\"'(])"  # English: ". The"
    r"|(?<=[.!?۔؟])\s+(?=[" + _URDU + r"])"  # Urdu: "۔ آج" / "? آپ"
    r"|(?<=[۔؟])\s+"  # after an Urdu full stop or question mark, whatever comes next
)
#: espeak marks words it read in another language: "(en)bˈeɪsɪkli(ur)". Kokoro must not see the marks.
_LANG_FLAG = re.compile(r"\([a-z]{2}(?:-[a-z]{2,3})?\)")


def has_urdu(text: str) -> bool:
    return bool(_URDU_LETTER.search(text))


def can_voice(text: str) -> bool:
    """True when Kokoro can say this: English, Roman Urdu, or Urdu script (with English words in it)."""
    return bool(text.strip()) and bool(_SPEAKABLE.match(text))


def split_sentences(text: str) -> list[str]:
    """Splits a paragraph into sentences to speak one at a time."""
    parts = [p.strip() for p in _SENTENCE_END.split(text.strip())]
    return [p for p in parts if p]


def is_urdu_voice(voice: str) -> bool:
    return voice.startswith("h")


def urdu_voice_like(voice: str) -> str:
    """The Urdu voice closest to an English one (female → female)."""
    return "hm_omega" if len(voice) > 1 and voice[1] == "m" else DEFAULT_URDU_VOICE


def _lang_for(voice: str) -> str:
    return "en-gb" if voice.startswith("b") else "en-us"


class Voice(Protocol):
    error: Optional[str]

    def ready(self) -> bool: ...
    def load(self) -> None: ...
    def synthesize(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]: ...


class KokoroVoice:
    """Loads (and first downloads) Kokoro, then turns text into audio samples."""

    def __init__(self, model_dir: Path):
        self.model_dir = Path(model_dir)
        self.error: Optional[str] = None
        self.downloading = False
        self._kokoro = None
        self._lock = threading.Lock()

    def ready(self) -> bool:
        return self._kokoro is not None

    def load(self) -> None:
        with self._lock:
            if self._kokoro is not None:
                return
            try:
                self._download_missing()
                from kokoro_onnx import Kokoro  # imported late: heavy

                kokoro = Kokoro(str(self.model_dir / "kokoro-v1.0.onnx"), str(self.model_dir / "voices-v1.0.bin"))
                kokoro.create("Ready.", voice=DEFAULT_VOICE, speed=1.0, lang="en-us")  # warm up
                self._kokoro = kokoro
                self.error = None
            except Exception as err:  # no internet on first start, broken file, missing package
                self.error = f"The natural voice could not load: {err}"

    def _download_missing(self) -> None:
        self.model_dir.mkdir(parents=True, exist_ok=True)
        for name, url in MODEL_FILES.items():
            target = self.model_dir / name
            if target.exists() and target.stat().st_size > 0:
                continue
            self.downloading = True
            part = target.with_suffix(target.suffix + ".part")
            with urllib.request.urlopen(url, timeout=60) as response, open(part, "wb") as out:
                shutil.copyfileobj(response, out, length=1 << 20)
            part.replace(target)
        self.downloading = False

    def synthesize(self, text: str, voice: str, speed: float) -> tuple[np.ndarray, int]:
        if self._kokoro is None:
            raise RuntimeError("voice not loaded")
        if has_urdu(text) and not is_urdu_voice(voice):
            voice = urdu_voice_like(voice)  # Urdu in an English talk (e.g. a question asked in Urdu)
        if is_urdu_voice(voice):
            phonemes = urdu_phonemes(self._kokoro, text)
            samples, rate = self._kokoro.create(phonemes, voice=voice, speed=speed, is_phonemes=True)
        else:
            samples, rate = self._kokoro.create(text, voice=voice, speed=speed, lang=_lang_for(voice))
        return np.asarray(samples, dtype=np.float32), int(rate)


def urdu_phonemes(kokoro, text: str) -> str:
    """Urdu script (with English words in English letters) → the sounds Kokoro speaks.
    espeak reads the Urdu words as Urdu and switches to English for English words."""
    phonemes = kokoro.tokenizer.phonemize(text, "ur")
    # espeak's Urdu gives "ʂ" (a Hindi-style retroflex) for plain s (س / ص): Urdu says s.
    return _LANG_FLAG.sub("", phonemes).replace("ʂ", "s")


# ── Playing audio ────────────────────────────────────────────────────────────


class Player(Protocol):
    def start(self, wav: Path) -> None: ...
    def stop(self) -> None: ...


class WindowsPlayer:
    """Plays a WAV file without blocking (Windows' built-in winsound)."""

    def start(self, wav: Path) -> None:
        import winsound  # type: ignore

        winsound.PlaySound(str(wav), winsound.SND_FILENAME | winsound.SND_ASYNC | winsound.SND_NODEFAULT)

    def stop(self) -> None:
        import winsound  # type: ignore

        winsound.PlaySound(None, 0)


class CommandPlayer:
    """macOS / Linux: afplay or aplay."""

    def __init__(self, command: list[str]):
        self.command = command
        self._proc: Optional[subprocess.Popen] = None

    def start(self, wav: Path) -> None:
        self.stop()
        self._proc = subprocess.Popen([*self.command, str(wav)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def stop(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
        self._proc = None


class SilentPlayer:
    """No sound device (tests, servers): timing still works."""

    def start(self, wav: Path) -> None:
        pass

    def stop(self) -> None:
        pass


def default_player() -> Player:
    if sys.platform == "win32":
        return WindowsPlayer()
    for cmd in (["afplay"], ["aplay", "-q"]):
        if shutil.which(cmd[0]):
            return CommandPlayer(cmd)
    return SilentPlayer()


# ── Speaker: a queue of sentences, said one after another ──────────────────


@dataclass
class _Clip:
    path: Path
    seconds: float


@dataclass
class _Item:
    text: str
    clip: "asyncio.Future[_Clip]"
    done: "asyncio.Future[bool]" = field(default=None)  # type: ignore[assignment]


class Speaker:
    """
    say(text) queues a sentence and resolves True once it has been heard, or False
    if it was cut off by stop(). Audio is made in a background thread, one sentence
    ahead of what is playing, and cached on disk by (voice, speed, text).
    """

    def __init__(
        self,
        voice: Voice,
        cache_dir: Path,
        settings: Callable[[], tuple[str, float]],
        player: Optional[Player] = None,
    ):
        self.voice = voice
        self.cache_dir = Path(cache_dir)
        self.settings = settings  # () -> (voice id, speed)
        self.player = player or default_player()
        # Two queues: "urgent" for what is about to be said, "spare" for making audio ahead of
        # time (a whole deck after preparing). A live answer never waits behind the spare queue.
        self._urgent = ThreadPoolExecutor(max_workers=1, thread_name_prefix="flick-voice")
        self._spare = ThreadPoolExecutor(max_workers=1, thread_name_prefix="flick-voice-ahead")
        self._making: dict[str, tuple[Future, bool]] = {}  # key -> (future, urgent)
        self._making_lock = threading.Lock()
        self._queue: list[_Item] = []
        self._wake: Optional[asyncio.Event] = None
        self._idle: Optional[asyncio.Event] = None
        self._interrupt: Optional[asyncio.Event] = None
        self._worker: Optional[asyncio.Task] = None
        self.speaking = False
        self._closed = False
        #: Goes up on every stop(). An answer remembers the number it started with and stops
        #: voicing new sentences once it changes, even if its text keeps streaming in.
        self.epoch = 0

    # Public ────────────────────────────────────────────────────────────────

    def available(self) -> bool:
        return self.voice.ready()

    def say(self, text: str) -> "asyncio.Future[bool]":
        """Queues one sentence. The future resolves when it has been said (True) or cut off (False)."""
        loop = asyncio.get_running_loop()
        if self._closed:  # shutting down: nothing more is said
            done = loop.create_future()
            done.set_result(False)
            return done
        self._ensure_worker()
        item = _Item(text=text, clip=asyncio.wrap_future(self._make(text, urgent=True), loop=loop), done=loop.create_future())
        self._queue.append(item)
        self._idle.clear()  # type: ignore[union-attr]
        self._wake.set()  # type: ignore[union-attr]
        return item.done

    def prefetch(self, texts: list[str], urgent: bool = False) -> None:
        """Makes audio ahead of time without playing it. urgent: needed in the next seconds."""
        if not self.available() or self._closed:
            return
        for text in texts:
            if can_voice(text):
                self._make(text, urgent=urgent)

    def stop(self) -> None:
        """Stops at once: the sentence playing now is cut and the queue is emptied."""
        self.epoch += 1
        queued, self._queue = self._queue, []
        for item in queued:
            if not item.done.done():
                item.done.set_result(False)
        if self._interrupt is not None:
            self._interrupt.set()
        self.player.stop()
        # Free the urgent queue for what comes next (e.g. the answer to a raised hand).
        with self._making_lock:
            for key, (future, urgent) in list(self._making.items()):
                if urgent and future.cancel():
                    del self._making[key]

    async def idle(self) -> None:
        """Waits until everything queued has been said."""
        if self._idle is not None:
            await self._idle.wait()

    def close(self) -> None:
        self._closed = True
        self.stop()
        if self._worker is not None and not self._worker.done():
            try:
                self._worker.cancel()
            except RuntimeError:
                pass  # its event loop is already closed
        self._urgent.shutdown(wait=False, cancel_futures=True)
        self._spare.shutdown(wait=False, cancel_futures=True)

    # Internals ─────────────────────────────────────────────────────────────

    def _ensure_worker(self) -> None:
        if self._worker is None or self._worker.done():
            self._wake = asyncio.Event()
            self._idle = asyncio.Event()
            self._idle.set()
            self._interrupt = asyncio.Event()
            self._worker = asyncio.ensure_future(self._run())

    def _key(self, text: str) -> str:
        voice, speed = self.settings()
        return hashlib.sha1(f"{voice}|{speed:.2f}|{text}".encode("utf-8")).hexdigest()

    def _make(self, text: str, urgent: bool) -> Future:
        """Starts (or reuses) making the audio for this text. Returns a thread future."""
        key = self._key(text)
        with self._making_lock:
            existing = self._making.get(key)
            if existing is not None:
                future, was_urgent = existing
                failed = future.cancelled() or (future.done() and future.exception() is not None)
                waiting_in_spare = not was_urgent and not future.running() and not future.done()
                if not failed and not (urgent and waiting_in_spare):
                    return future
                if waiting_in_spare:
                    future.cancel()  # needed now: jump the queue
            pool = self._urgent if urgent else self._spare
            future = pool.submit(self._synthesize_to_file, key, text)
            self._making[key] = (future, urgent)
            if len(self._making) > 2000:  # keep the dict small; files stay cached on disk
                for old in list(self._making)[:1000]:
                    if self._making[old][0].done():
                        del self._making[old]
            return future

    def _synthesize_to_file(self, key: str, text: str) -> _Clip:
        path = self.cache_dir / f"{key}.wav"
        if path.exists():
            with wave.open(str(path), "rb") as w:
                return _Clip(path, w.getnframes() / float(w.getframerate()))
        voice, speed = self.settings()
        samples, rate = self.voice.synthesize(text, voice, speed)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
        tmp = path.with_suffix(".tmp")
        with wave.open(str(tmp), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm)
        tmp.replace(path)
        return _Clip(path, len(samples) / float(rate))

    async def _run(self) -> None:
        assert self._wake and self._idle and self._interrupt
        while True:
            if not self._queue:
                self.speaking = False
                self._idle.set()
                self._wake.clear()
                await self._wake.wait()
                continue
            item = self._queue[0]
            try:
                clip = await item.clip
            except asyncio.CancelledError:
                # Two very different cancellations land here: Stop cancelled this sentence's audio
                # (skip it), or the speaker itself is shutting down (must end, or shutdown hangs).
                task = asyncio.current_task()
                if self._closed or (task is not None and task.cancelling()) or not item.clip.cancelled():
                    raise
                clip = None
            except Exception:
                clip = None  # could not make this sentence: skip it
            if item.done.done():  # stopped while the audio was being made
                continue
            if self._queue and self._queue[0] is item:
                self._queue.pop(0)
            if clip is None:
                item.done.set_result(False)
                continue
            self._interrupt.clear()
            self.speaking = True
            self.player.start(clip.path)
            try:
                await asyncio.wait_for(self._interrupt.wait(), timeout=clip.seconds + 0.05)
                finished = False  # interrupted
            except asyncio.TimeoutError:
                finished = True
            if not item.done.done():
                item.done.set_result(finished)
