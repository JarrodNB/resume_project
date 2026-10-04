"""
Description: Shared pytest setup. Blocks real LLM requests and Langfuse exports, and provides
fake task dependencies.
Index:
    - fake_file_storage: an empty FakeFileStorage
    - fake_job_site: an empty FakeJobSite
    - fake_context_reader: an empty FakeGapAnalysisContextReader
    - task_dependencies: TaskDependencies backed by fakes
"""

import os

os.environ["LANGFUSE_TRACING_ENABLED"] = "false"

import pytest
from pydantic_ai import models

from tests.fakes import FakeFileStorage, FakeGapAnalysisContextReader, FakeJobSite
from worker.settings import WorkerSettings
from worker.task_dependencies import TaskDependencies

models.ALLOW_MODEL_REQUESTS = False


@pytest.fixture
def fake_file_storage() -> FakeFileStorage:
    """An empty fake file store."""
    return FakeFileStorage()


@pytest.fixture
def fake_job_site() -> FakeJobSite:
    """An empty fake job site (every URL is a 404)."""
    return FakeJobSite()


@pytest.fixture
def fake_context_reader() -> FakeGapAnalysisContextReader:
    """An empty fake database reader (every job is missing)."""
    return FakeGapAnalysisContextReader()


@pytest.fixture
def task_dependencies(
    fake_file_storage: FakeFileStorage,
    fake_job_site: FakeJobSite,
    fake_context_reader: FakeGapAnalysisContextReader,
) -> TaskDependencies:
    """Task dependencies backed by fakes."""
    return TaskDependencies(
        settings=WorkerSettings(),
        file_storage=fake_file_storage,
        http_client=fake_job_site.build_client(),
        read_gap_analysis_context=fake_context_reader,
    )
