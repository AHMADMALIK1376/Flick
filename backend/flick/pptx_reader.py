"""Reads a PowerPoint (.pptx) file: each slide's title, body text, tables and
speaker notes, in the order the slides are presented."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Iterable, Union

from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE, PP_PLACEHOLDER
from pptx.exc import PackageNotFoundError

from .models import Slide

TITLE_PLACEHOLDERS = {PP_PLACEHOLDER.TITLE, PP_PLACEHOLDER.CENTER_TITLE}


class PptxError(ValueError):
    """The file could not be read as a presentation. The message is shown to the user."""


def read_pptx(source: Union[str, Path, bytes]) -> list[Slide]:
    try:
        prs = Presentation(io.BytesIO(source) if isinstance(source, bytes) else str(source))
    except (PackageNotFoundError, zipfile.BadZipFile, KeyError):
        raise PptxError("This file is not a valid .pptx presentation.") from None
    except FileNotFoundError:
        raise PptxError("The presentation file was not found.") from None

    slides: list[Slide] = []
    # prs.slides is in presentation order (the slide list), not file-name order.
    for number, slide in enumerate(prs.slides, start=1):
        title_lines: list[str] = []
        body_lines: list[str] = []
        for shape in _all_shapes(slide.shapes):
            lines = _shape_lines(shape)
            if not lines:
                continue
            if _is_title(shape):
                title_lines.extend(lines)
            else:
                body_lines.extend(lines)

        # No title placeholder: the first line names the slide.
        if not title_lines and body_lines:
            title_lines.append(body_lines.pop(0))

        notes = ""
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
            notes = _clean(slide.notes_slide.notes_text_frame.text)

        slides.append(
            Slide(number=number, title=" ".join(title_lines).strip(), body="\n".join(body_lines).strip(), notes=notes)
        )

    if not slides:
        raise PptxError("No slides were found in this presentation.")
    return slides


def _all_shapes(shapes) -> Iterable:
    """Every shape, including those inside groups, in document order."""
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _all_shapes(shape.shapes)
        else:
            yield shape


def _is_title(shape) -> bool:
    if not shape.is_placeholder:
        return False
    try:
        return shape.placeholder_format.type in TITLE_PLACEHOLDERS
    except ValueError:
        return False


def _shape_lines(shape) -> list[str]:
    lines: list[str] = []
    if shape.has_text_frame:
        for paragraph in shape.text_frame.paragraphs:
            text = _clean("".join(run.text for run in paragraph.runs) or paragraph.text)
            if text:
                lines.append(text)
    if getattr(shape, "has_table", False) and shape.has_table:
        for row in shape.table.rows:
            cells = [_clean(cell.text) for cell in row.cells]
            if any(cells):
                lines.append(" | ".join(c for c in cells if c))
    return lines


def _clean(text: str) -> str:
    return " ".join(text.split())
