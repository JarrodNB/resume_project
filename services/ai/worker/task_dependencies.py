"""
Description: Shared services that task handlers need, built once at worker startup and
swapped for fakes in tests.
Index:
    - FileStorage: protocol for downloading uploaded files
    - GapAnalysisContextReader: reads a user's job and career library (None if no such job)
    - TaskDependencies: settings, file storage, HTTP client, and database reader for handlers
    - build_http_client: the HTTP client job scrapers fetch pages with
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

import httpx

from database.tailoring_sources import TailoringSources
from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext
from schemas.summary_generation import SummaryCommand, SummaryGenerationInput
from schemas.library_review import LibraryReviewInput
from schemas.study_guide import StudyGuideInput
from worker.product_name import USER_AGENT
from worker.queue_messages import AiTaskMessage
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
    read_study_guide_sources: Callable[[AiTaskMessage], StudyGuideInput | None] | None = None
    read_task_command: Callable[[AiTaskMessage], AiTaskMessage | None] | None = None
    read_tailoring_sources: Callable[[UUID, UUID, UUID, UUID | None], TailoringSources | None] | None = None
    read_interview_question_sources: Callable[[AiTaskMessage], dict | None] | None = None
    read_career_library: Callable[[UUID], CareerLibrary] | None = None
    read_summary_sources: Callable[[UUID, SummaryCommand], SummaryGenerationInput | None] | None = None
    read_library_review: Callable[[UUID, str], LibraryReviewInput] | None = None
    read_library_edit: Callable[[AiTaskMessage], object] | None = None
    score_job_listings: Callable[[UUID, Sequence[tuple[str, list[float]]], str], list[tuple[str, float]]] | None = None


def build_http_client(settings: WorkerSettings) -> httpx.Client:
    """Build the injected scraper client; delegate network requests with proxy/CA trust."""
    from scrapers.public_job_transport import PublicJobTransport

    return httpx.Client(
        timeout=settings.job_page_fetch_timeout_seconds,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
        # Routing/proxies/CA trust are handled by the delegate inside the transport.
        # Avoid an outer auto-proxy transport bypassing that pinned-TLS delegate.
        transport=PublicJobTransport(), trust_env=False,
    )
