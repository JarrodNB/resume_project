"""
Description: Shared services that task handlers need, built once at worker startup and
swapped for fakes in tests.
Index:
    - FileStorage: protocol for downloading uploaded files
    - TaskDependencies: settings + file storage + HTTP client passed to every handler
    - build_http_client: the HTTP client job scrapers fetch pages with
"""

from dataclasses import dataclass
from typing import Protocol

import httpx

from worker.settings import WorkerSettings

USER_AGENT = "ThroughlineJobScraper/0.1"


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


def build_http_client(settings: WorkerSettings) -> httpx.Client:
    """An HTTP client with a timeout that follows redirects."""
    return httpx.Client(
        timeout=settings.job_page_fetch_timeout_seconds,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )
