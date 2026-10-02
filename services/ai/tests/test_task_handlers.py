"""
Description: Tests for task dispatch and the parse_resume handler (agent replaced by TestModel).
Index:
    - build_parse_resume_task: a parse_resume task pointing at a fake uploaded file
    - test_*: one behavior per test
"""

import asyncio
from unittest.mock import patch
from uuid import uuid4

import pytest
from pydantic_ai import capture_run_messages
from pydantic_ai.messages import UserPromptPart
from pydantic_ai.models.test import TestModel

from agents.resume_parsing_agent import resume_parsing_agent
from documents.extract_document_text import DOCX_CONTENT_TYPE
from schemas.parsed_resume import ParsedResume
from tests.fakes import FakeFileStorage, build_docx_bytes
from worker.parse_resume_handler import UNREADABLE_FILE_MESSAGE
from worker.queue_messages import AiTaskMessage
from worker.task_dependencies import TaskDependencies
from worker.task_handlers import handle_ai_task

FILE_KEY = "uploads/resume-key"


def build_parse_resume_task(content_type: str = DOCX_CONTENT_TYPE) -> AiTaskMessage:
    """Builds a parse_resume task for the file stored under FILE_KEY."""
    return AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="parse_resume",
        input={
            "source_file": {
                "key": FILE_KEY,
                "filename": "resume.docx",
                "content_type": content_type,
            }
        },
    )


def test_unsupported_task_type_fails_with_message(task_dependencies: TaskDependencies) -> None:
    """Task types without an agent yet report a clear failure."""
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="tailor_resume")

    result = handle_ai_task(task, task_dependencies)

    assert result.status == "failed"
    assert result.error_message == "Task type tailor_resume is not supported yet"


def test_parse_resume_returns_parsed_resume(
    task_dependencies: TaskDependencies, fake_file_storage: FakeFileStorage
) -> None:
    """The uploaded file's text goes to the agent, and its output becomes the result."""
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(["Jane Doe", "Engineer at Acme"])

    with capture_run_messages() as messages, resume_parsing_agent.override(model=TestModel()):
        result = handle_ai_task(build_parse_resume_task(), task_dependencies)

    assert result.status == "completed"
    ParsedResume.model_validate(result.result["parsed_resume"])
    [user_prompt] = [part for part in messages[0].parts if isinstance(part, UserPromptPart)]
    assert user_prompt.content == "Jane Doe\nEngineer at Acme"


def test_parse_resume_reports_token_usage(
    task_dependencies: TaskDependencies, fake_file_storage: FakeFileStorage
) -> None:
    """The completed result carries the agent run's tokens and cost for the configured model."""
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(["Jane Doe", "Engineer at Acme"])

    with resume_parsing_agent.override(model=TestModel()):
        result = handle_ai_task(build_parse_resume_task(), task_dependencies)

    [model_usage] = result.usage
    assert model_usage.model == task_dependencies.settings.resume_parsing_model
    assert model_usage.input_tokens > 0
    assert model_usage.output_tokens > 0
    assert model_usage.cost_microdollars > 0


def test_parse_resume_gives_up_at_the_run_deadline(
    task_dependencies: TaskDependencies, fake_file_storage: FakeFileStorage
) -> None:
    """A run slower than llm_run_timeout_seconds is cancelled with TimeoutError."""
    fake_file_storage.files[FILE_KEY] = build_docx_bytes(["Jane Doe", "Engineer at Acme"])
    task_dependencies.settings.llm_run_timeout_seconds = 0.01

    async def never_finishes(*_args: object, **_kwargs: object) -> None:
        """Stands in for a model call that hangs."""
        await asyncio.sleep(60)

    with (
        resume_parsing_agent.override(model=TestModel()),
        patch.object(TestModel, "request", never_finishes),
        pytest.raises(TimeoutError),
    ):
        handle_ai_task(build_parse_resume_task(), task_dependencies)


def test_parse_resume_fails_for_file_without_text(
    task_dependencies: TaskDependencies, fake_file_storage: FakeFileStorage
) -> None:
    """A file with no extractable text fails with a user-facing message and no LLM call."""
    fake_file_storage.files[FILE_KEY] = build_docx_bytes([])

    result = handle_ai_task(build_parse_resume_task(), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == UNREADABLE_FILE_MESSAGE


def test_parse_resume_fails_for_unsupported_file_type(
    task_dependencies: TaskDependencies, fake_file_storage: FakeFileStorage
) -> None:
    """Only PDF and DOCX are accepted."""
    fake_file_storage.files[FILE_KEY] = b"plain text"

    result = handle_ai_task(build_parse_resume_task(content_type="text/plain"), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == UNREADABLE_FILE_MESSAGE
