"""
Description: Shared pytest setup. Blocks real LLM requests and Logfire exports, and provides
fake task dependencies.
Index:
    - fake_file_storage: an empty FakeFileStorage
    - fake_job_site: an empty FakeJobSite
    - fake_context_reader: an empty FakeGapAnalysisContextReader
    - task_dependencies: TaskDependencies backed by fakes
    - fake_prompt_screen: synthetic allowed screening for unrelated unit tests
    - fake_known_contact: prevents unit task traces from querying PostgreSQL
"""

import os

os.environ["LOGFIRE_SEND_TO_LOGFIRE"] = "false"
os.environ.pop("LOGFIRE_TOKEN", None)

import pytest
from pydantic_ai import models

from tests.fakes import FakeFileStorage, FakeGapAnalysisContextReader, FakeJobSite
from worker.settings import WorkerSettings
from worker.task_dependencies import TaskDependencies

models.ALLOW_MODEL_REQUESTS = False


@pytest.fixture(autouse=True)
def fake_known_contact(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    """Keeps ordinary worker tests independent of PostgreSQL while retaining trace hooks."""
    if request.node.get_closest_marker("db"):
        return
    from worker.known_contact import KnownContact

    def empty_contact(_task: object) -> KnownContact:
        """Returns no profile contact without a database connection."""
        return KnownContact()

    monkeypatch.setattr("worker.contact_mask._load_known_contact", empty_contact)


@pytest.fixture(autouse=True)
def fake_prompt_screen(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    """Mocks only the capability's classifier; guardrail tests exercise the real policy."""
    if request.node.get_closest_marker("real_guardrail"):
        return
    from pydantic_ai.usage import RunUsage

    from agents.user_text_screen_agent import UserTextScreenRun
    from schemas.user_text_screen import UserTextScreen

    async def allow_text(*_args: object) -> UserTextScreenRun:
        """A confident benign classification without any provider requests."""
        return UserTextScreenRun(
            UserTextScreen(prompt_injection=False, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1.0, "harmful_request": 1.0}, RunUsage(),
        )

    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", allow_text)


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
