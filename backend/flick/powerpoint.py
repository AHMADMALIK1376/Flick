"""Asks the running Microsoft PowerPoint (Windows) which slide is on screen and
which file is open. Read-only: Flick never changes the presentation.

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
    ):
        self.supported = platform == "win32"
        if query is not None:
            self._query = query
        elif self.supported and _has_pywin32():
            self._query = _com_query
        else:
            self._query = lambda kind: _powershell(_PS_SLIDE if kind == "slide" else _PS_PATH)
        self._clock = clock
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
