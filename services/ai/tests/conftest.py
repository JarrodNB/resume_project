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
    - offline_model_resolution: supplies fake provider models beneath production accounting
"""

import os

os.environ["LOGFIRE_SEND_TO_LOGFIRE"] = "false"
os.environ.pop("LOGFIRE_TOKEN", None)
# Tests never reach a real ai-mcp service; tool tests start their own local server.
os.environ["MCP_TOOLS_SECRET"] = "test-only-mcp-tools-secret-0123456789"
os.environ["MCP_TOOLS_URL"] = "http://127.0.0.1:9/mcp"

import pytest
from pydantic_ai import models

from database.tailoring_sources import TailoringSources
from tests.fakes import FakeFileStorage, FakeGapAnalysisContextReader, FakeJobSite
from worker.settings import WorkerSettings
from worker.task_dependencies import TaskDependencies

models.ALLOW_MODEL_REQUESTS = False


@pytest.fixture
def offline_model_resolution(monkeypatch):
    """Replaces SDK model resolution while preserving the production model adapters."""
    from pydantic_ai.models import fallback, wrapper

    original = models.infer_model
    providers = {}

    def resolve(model, *args, **kwargs):
        """Resolves registered provider names to ordinary offline models."""
        if isinstance(model, str) and model in providers:
            return providers[model]
        return original(model, *args, **kwargs)

    def register(name, model):
        """Registers a synthetic provider without installing task-accounting behavior."""
        providers[name] = model

    monkeypatch.setattr(models, "infer_model", resolve)
    monkeypatch.setattr(wrapper, "infer_model", resolve)
    monkeypatch.setattr(fallback, "infer_model", resolve)
    return register


@pytest.fixture
def offline_resume_model_resolution(offline_model_resolution, task_dependencies):
    """Registers one fake for both configured resume parsing models."""
    def register(model):
        settings = task_dependencies.settings
        offline_model_resolution(settings.resume_parsing_model, model)
        offline_model_resolution(settings.generative_fallback_model, model)

    return register


@pytest.fixture(autouse=True)
def fake_known_contact(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    """Keeps ordinary worker tests independent of PostgreSQL while retaining trace hooks."""
    if request.node.get_closest_marker("db"):
        return
    from privacy.known_contact import KnownContact

    def empty_contact(_task: object) -> KnownContact:
        """Returns no profile contact without a database connection."""
        return KnownContact()

    monkeypatch.setattr("worker.contact_context._load_known_contact", empty_contact)


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
    monkeypatch.setattr("screening.prompt_guardrail.screen_prompt_text", allow_text)


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
        read_task_command=lambda task: task,
        read_tailoring_sources=lambda task, user, job, analysis: (
            TailoringSources(context, {}, None, [])
            if (context := fake_context_reader(user, job)) is not None else None),
    )
