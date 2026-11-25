"""Talks to the running Microsoft PowerPoint (Windows): which slide is on screen,
which file is open, and (for "present for me") showing a slide in the slide show.
Flick never edits the presentation.

Uses PowerPoint's COM automation directly through pywin32, which answers in a
few milliseconds. Without pywin32 it falls back to PowerShell (about half a
second). On other platforms, or with PowerPoint closed, answers are None.
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
import time
from typing import Callable, Optional

#: A cached slide number older than this is read again.
SLIDE_CACHE_S = 15.0
POWERSHELL_TIMEOUT_S = 4.0

_ATTACH = r"""
$ErrorActionPreference = 'Stop'
try { $pp = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch { exit 0 }
"""
_PS_SLIDE = _ATTACH + r"""
try { if ($pp.SlideShowWindows.Count -gt 0) { $pp.SlideShowWindows.Item(1).View.Slide.SlideIndex; exit 0 } } catch {}
try { if ($pp.Windows.Count -gt 0) { $pp.ActiveWindow.View.Slide.SlideIndex } } catch {}
"""
_PS_PATH = _ATTACH + r"""
try { if ($pp.SlideShowWindows.Count -gt 0) { $pp.SlideShowWindows.Item(1).Presentation.FullName; exit 0 } } catch {}
try { if ($pp.Presentations.Count -gt 0) { $pp.ActivePresentation.FullName; exit 0 } } catch {}
try { if ($pp.ProtectedViewWindows.Count -gt 0) { $pp.ProtectedViewWindows.Item(1).Presentation.FullName } } catch {}
"""


def _com_query(kind: str) -> Optional[str]:
    """Runs in a worker thread. kind: 'slide' or 'path'."""
    import pythoncom  # type: ignore
    import win32com.client  # type: ignore

    pythoncom.CoInitialize()
    try:
        try:
            app = win32com.client.GetActiveObject("PowerPoint.Application")
        except Exception:
            return None
        attempts: list[Callable[[], object]]
        if kind == "slide":
            attempts = [
                lambda: app.SlideShowWindows(1).View.Slide.SlideIndex if app.SlideShowWindows.Count else None,
                lambda: app.ActiveWindow.View.Slide.SlideIndex if app.Windows.Count else None,
            ]
        else:
            attempts = [
                lambda: app.SlideShowWindows(1).Presentation.FullName if app.SlideShowWindows.Count else None,
                lambda: app.ActivePresentation.FullName if app.Presentations.Count else None,
                # A file from the internet opens in Protected View, outside Presentations.
                lambda: app.ProtectedViewWindows(1).Presentation.FullName if app.ProtectedViewWindows.Count else None,
            ]
        for attempt in attempts:
            try:
                value = attempt()
            except Exception:
                continue
            if value not in (None, ""):
                return str(value)
        return None
    finally:
        pythoncom.CoUninitialize()


#: Why a slide could not be shown (codes → what to tell the presenter).
SHOW_PROBLEMS = {
    "no_powerpoint": "PowerPoint isn't open. Open {name} in PowerPoint and Flick will move the slides.",
    "not_open": "{name} isn't open in PowerPoint. Open it there and Flick will move the slides.",
    "protected": 'PowerPoint opened {name} in Protected View. Click "Enable Editing" in PowerPoint so Flick can move the slides.',
    "error": "Flick couldn't move PowerPoint's slides. Start the slide show in PowerPoint and try again.",
}


def _same_file(full_name: object, path: Optional[str], name: Optional[str]) -> bool:
    """Is PowerPoint's file (FullName) the deck Flick is presenting? Same path, or else same file name."""
    full = str(full_name or "").replace("/", "\\").lower()
    if path and full == path.replace("/", "\\").lower():
        return True
    return bool(name) and full.rsplit("\\", 1)[-1] == str(name).lower()


def _com_show_slide(number: int, path: Optional[str] = None, name: Optional[str] = None) -> str:
    """
    Runs in a worker thread. Shows slide `number` full screen in the deck's slide show → "ok" or a
    SHOW_PROBLEMS code. Finds the deck's slide show, or its open window (starting the slide show),
    leaves Protected View if needed, or opens the file itself (read-only) if it has a real path.
    """
    import os

    import pythoncom  # type: ignore
    import win32com.client  # type: ignore

    pythoncom.CoInitialize()
    try:
        can_open = bool(path) and os.path.isabs(path) and os.path.exists(path)  # type: ignore[arg-type]
        try:
            app = win32com.client.GetActiveObject("PowerPoint.Application")
        except Exception:
            if not can_open:
                return "no_powerpoint"
            app = win32com.client.Dispatch("PowerPoint.Application")
        matches = lambda pres: not (path or name) or _same_file(pres.FullName, path, name)  # noqa: E731
        try:
            # 1. Its slide show is already running.
            for i in range(1, app.SlideShowWindows.Count + 1):
                window = app.SlideShowWindows(i)
                if matches(window.Presentation):
                    window.View.GotoSlide(number)
                    return "ok"
            # 2. It is open for editing: start its slide show.
            pres = next(
                (app.Presentations(i) for i in range(1, app.Presentations.Count + 1) if matches(app.Presentations(i))),
                None,
            )
            # 3. It is in Protected View (downloaded files): leave it.
            if pres is None:
                for i in range(1, app.ProtectedViewWindows.Count + 1):
                    window = app.ProtectedViewWindows(i)
                    if matches(window.Presentation):
                        try:
                            pres = window.Edit()
                        except Exception:
                            return "protected"
                        break
            # 4. Not open: open it ourselves (read-only, Flick never edits it).
            if pres is None:
                if not can_open:
                    return "not_open"
                pres = app.Presentations.Open(path, True, False, True)  # ReadOnly, Untitled, WithWindow
            show = pres.SlideShowSettings.Run()
            show.View.GotoSlide(number)
            try:
                show.Activate()
            except Exception:
                pass
            return "ok"
        except Exception:
            return "error"
    finally:
        pythoncom.CoUninitialize()


def _ps_show_slide(number: int) -> str:
    return _ATTACH.replace("exit 0", "'no_powerpoint'; exit 0") + rf"""
try {{
  if ($pp.SlideShowWindows.Count -gt 0) {{ $v = $pp.SlideShowWindows.Item(1).View }}
  elseif ($pp.Presentations.Count -gt 0) {{ $v = $pp.ActivePresentation.SlideShowSettings.Run().View }}
  elseif ($pp.ProtectedViewWindows.Count -gt 0) {{ $v = $pp.ProtectedViewWindows.Item(1).Edit().SlideShowSettings.Run().View }}
  else {{ 'not_open'; exit 0 }}
  $v.GotoSlide({int(number)}); 'ok'
}} catch {{ 'error' }}
"""


def _powershell(script: str) -> Optional[str]:
    try:
        out = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
            capture_output=True,
            text=True,
            timeout=POWERSHELL_TIMEOUT_S,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    lines = [l.strip() for l in out.splitlines() if l.strip()]
    return lines[-1] if lines else None


def _has_pywin32() -> bool:
    try:
        import win32com.client  # type: ignore  # noqa: F401

        return True
    except ImportError:
        return False


class PowerPointBridge:
    def __init__(
        self,
        query: Optional[Callable[[str], Optional[str]]] = None,
        platform: str = sys.platform,
        clock: Callable[[], float] = time.monotonic,
        show: Optional[Callable[..., object]] = None,
    ):
        self.supported = platform == "win32"
        if query is not None:
            self._query = query
        elif self.supported and _has_pywin32():
            self._query = _com_query
        else:
            self._query = lambda kind: _powershell(_PS_SLIDE if kind == "slide" else _PS_PATH)
        self._clock = clock
        if show is not None:
            self._show: Callable[..., object] = show
        elif self.supported and _has_pywin32():
            self._show = _com_show_slide
        else:
            self._show = lambda n, path=None, name=None: _powershell(_ps_show_slide(n)) or "no_powerpoint"
        self._cached: Optional[tuple[Optional[int], float]] = None
        self._in_flight: Optional[asyncio.Task] = None

    def prefetch_slide(self) -> None:
        """Start reading the slide now (when the presenter starts speaking) so answers don't wait."""
        if self.supported and self._in_flight is None:
            self._in_flight = asyncio.ensure_future(self._read_slide())

    async def current_slide(self, fresh: bool = False) -> Optional[int]:
        """The slide on screen. `fresh` skips the cache ("explain THIS slide" must be exact)."""
        if not self.supported:
            return None
        if self._in_flight is not None:
            return await asyncio.shield(self._in_flight)
        if not fresh and self._cached and self._clock() - self._cached[1] < SLIDE_CACHE_S:
            return self._cached[0]
        self._in_flight = asyncio.ensure_future(self._read_slide())
        return await asyncio.shield(self._in_flight)

    async def show_slide(self, number: int, path: Optional[str] = None, name: Optional[str] = None) -> Optional[str]:
        """
        Shows slide `number` of this deck in PowerPoint's slide show (starting it if needed).
        → None when it worked, else a sentence for the presenter saying what to do.
        """
        if not self.supported:
            return None
        try:
            result = await asyncio.to_thread(self._show, number, path, name)
        except Exception:
            result = "error"
        if result is True or result == "ok":
            self._cached = (number, self._clock())
            return None
        code = result if isinstance(result, str) and result in SHOW_PROBLEMS else "error"
        return SHOW_PROBLEMS[code].format(name=name or "your presentation")

    async def active_presentation_path(self) -> Optional[str]:
        if not self.supported:
            return None
        return await asyncio.to_thread(self._query, "path")

    async def _read_slide(self) -> Optional[int]:
        try:
            raw = await asyncio.to_thread(self._query, "slide")
            try:
                slide = int(str(raw).strip()) if raw is not None else None
            except ValueError:
                slide = None
            slide = slide if slide and slide > 0 else None
            self._cached = (slide, self._clock())
            return slide
        finally:
            self._in_flight = None
