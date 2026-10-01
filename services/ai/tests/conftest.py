"""
Description: Shared pytest setup. Blocks real LLM requests and Langfuse exports, and provides
fake task dependencies.
Index:
    - fake_file_storage: an empty FakeFileStorage
    - task_dependencies: TaskDependencies backed by fakes
"""

import os

os.environ["LANGFUSE_TRACING_ENABLED"] = "false"

import pytest
from pydantic_ai import models

from tests.fakes import FakeFileStorage
from worker.settings import WorkerSettings
from worker.task_dependencies import TaskDependencies

models.ALLOW_MODEL_REQUESTS = False


@pytest.fixture
def fake_file_storage() -> FakeFileStorage:
    """An empty fake file store."""
    return FakeFileStorage()


@pytest.fixture
def task_dependencies(fake_file_storage: FakeFileStorage) -> TaskDependencies:
    """Task dependencies backed by fakes."""
    return TaskDependencies(settings=WorkerSettings(), file_storage=fake_file_storage)
