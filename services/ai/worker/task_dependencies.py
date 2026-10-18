"""Provide the external services needed by one worker task.

Production readers are owner-scoped and read-only. Tests can inject offline readers,
including saved-screening lookup, without opening database connections.
"""

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import httpx

from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext
from worker.product_name import USER_AGENT
from worker.settings import WorkerSettings

GapAnalysisContextReader = Callable[[UUID, UUID], GapAnalysisContext | None]


class FileStorage(Protocol):
    """Anything that can download an uploaded file by key (S3FileStorage in production)."""

    def download_file(self, key: str) -> bytes:
        """Returns the bytes of the file stored under `key`."""
        ...


@dataclass(frozen=True)
class TaskDependencies:
    """What a handler may use besides the task message itself."""

    settings: WorkerSettings
    file_storage: FileStorage
    http_client: httpx.Client
    # Called with (user_id, job_id); production reads Postgres as ai_reader.
    read_gap_analysis_context: GapAnalysisContextReader
    read_career_library: Callable[[UUID], CareerLibrary] | None = None
    read_screening_successes: Callable[[UUID, list[tuple[str, str]]], set[tuple[str, str]]] | None = None


def build_http_client(settings: WorkerSettings) -> httpx.Client:
    """An HTTP client with a timeout that follows redirects."""
    return httpx.Client(
        timeout=settings.job_page_fetch_timeout_seconds,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )
