"""
Description: Shared services that task handlers need, built once at worker startup and
swapped for fakes in tests.
Index:
    - FileStorage: protocol for downloading uploaded files
    - TaskDependencies: settings + file storage passed to every handler
"""

from dataclasses import dataclass
from typing import Protocol

from worker.settings import WorkerSettings


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
