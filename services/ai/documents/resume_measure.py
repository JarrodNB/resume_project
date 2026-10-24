"""Render and measure a Markdown resume using the shared PDF module."""

import asyncio
import os
import subprocess
from dataclasses import dataclass
from io import BytesIO

from pypdf import PdfReader

MAX_MARKDOWN_CHARS = 100_000
MAX_PDF_BYTES = 10_000_000
RENDER_TIMEOUT_SECONDS = 20
RENDER_ENTRY = "/opt/resume-renderer/render.mjs"
PRINTABLE_TOP = 792 - 40
PRINTABLE_HEIGHT = 792 - 80


class ResumeRenderError(Exception):
    """The resume cannot be rendered within the worker's limits."""


@dataclass(frozen=True)
class ResumeMeasurement:
    pdf_bytes: bytes
    page_count: int
    final_page_occupied_share: float


def render_and_measure_resume(
    markdown: str, *, timeout_seconds: float = RENDER_TIMEOUT_SECONDS
) -> ResumeMeasurement:
    """Return PDF bytes and measured page information for one Markdown document."""
    if len(markdown) > MAX_MARKDOWN_CHARS:
        raise ResumeRenderError("Resume Markdown is too long")
    try:
        process = subprocess.run(
            ["node", os.environ.get("RESUME_RENDER_ENTRY", RENDER_ENTRY)],
            input=markdown.encode("utf-8"),
            capture_output=True,
            timeout=max(0.001, min(RENDER_TIMEOUT_SECONDS, timeout_seconds)),
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ResumeRenderError("Resume PDF rendering failed or timed out") from error
    if process.returncode or not process.stdout or len(process.stdout) > MAX_PDF_BYTES:
        raise ResumeRenderError("Resume PDF rendering failed or exceeded its size limit")
    return _measure_pdf(process.stdout)


async def render_and_measure_resume_async(
    markdown: str,
    *,
    timeout_seconds: float = RENDER_TIMEOUT_SECONDS,
) -> ResumeMeasurement:
    """Kill and reap the renderer when the task is cancelled, times out or fails."""
    if len(markdown) > MAX_MARKDOWN_CHARS:
        raise ResumeRenderError("Resume Markdown is too long")
    process = None
    try:
        process = await asyncio.create_subprocess_exec(
            "node",
            os.environ.get("RESUME_RENDER_ENTRY", RENDER_ENTRY),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        async with asyncio.timeout(max(0.001, min(RENDER_TIMEOUT_SECONDS, timeout_seconds))):
            stdout, _stderr = await process.communicate(markdown.encode("utf-8"))
        if process.returncode or not stdout or len(stdout) > MAX_PDF_BYTES:
            raise ResumeRenderError("Resume PDF rendering failed or exceeded its size limit")
        return _measure_pdf(stdout)
    except (OSError, TimeoutError) as error:
        raise ResumeRenderError("Resume PDF rendering failed or timed out") from error
    finally:
        if process is not None and process.returncode is None:
            try:
                process.kill()
            except ProcessLookupError:
                pass
            await process.wait()


def _measure_pdf(pdf_bytes: bytes) -> ResumeMeasurement:
    """Read page count and last-page text occupancy from the actual rendered bytes."""
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        page_count = len(reader.pages)
        if not page_count or page_count > 100:
            raise ResumeRenderError("Resume PDF has an unsupported page count")
        lowest = PRINTABLE_TOP

        def text_position(text, cm, tm, _font, font_size):
            nonlocal lowest
            if text.strip():
                # React PDF places text with a translation in the current matrix.
                lowest = min(lowest, float(cm[5]) + float(tm[5]) - float(font_size) * 0.25)

        reader.pages[-1].extract_text(visitor_text=text_position)
        occupied = max(0.0, min(1.0, (PRINTABLE_TOP - lowest) / PRINTABLE_HEIGHT))
        return ResumeMeasurement(pdf_bytes, page_count, occupied)
    except ResumeRenderError:
        raise
    except Exception as error:
        raise ResumeRenderError("Rendered resume PDF could not be measured") from error
