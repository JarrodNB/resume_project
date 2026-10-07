"""
Description: Tests for the parse_job_posting handler with the screen and the parse agent mocked.
Index:
    - build_parse_task: a parse_job_posting task
    - test_*: one behavior per test
"""

from uuid import uuid4

import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.usage import RunUsage

from agents.parse_job_posting_agent import JobPostingParseRun
from schemas.parsed_job_posting import ParsedJobPosting
from screening.screen_user_text import ScreenOutcome
from worker.parse_job_posting_handler import BLOCKED_AD_MESSAGE, COULD_NOT_READ_MESSAGE
from worker.queue_messages import AiTaskMessage
from worker.task_dependencies import TaskDependencies
from worker.task_handlers import handle_ai_task

AD = "AI Engineer at Acme. Required: 5 years of Python."


def build_parse_task(text: str = AD) -> AiTaskMessage:
    """A parse_job_posting task carrying the pasted ad."""
    return AiTaskMessage(
        ai_task_id=uuid4(), user_id=uuid4(), task_type="parse_job_posting", input={"text": text}
    )


def _allow(*_args: object, **_kwargs: object) -> ScreenOutcome:
    """A screen that lets the ad through, with usage to report."""
    return ScreenOutcome(
        allowed=True, usage=RunUsage(input_tokens=20, output_tokens=5), model="typesafe:jev-latest"
    )


def _parsed(**overrides: object) -> ParsedJobPosting:
    """A parse of AD, with any field replaced."""
    fields = {
        "title": "AI Engineer",
        "company": "Acme",
        "requirements": ["5 years of Python"],
        "nice_to_haves": [],
    }
    fields.update(overrides)
    return ParsedJobPosting.model_validate(fields)


def test_parse_job_posting_saves_fields_copied_from_the_ad(
    task_dependencies: TaskDependencies, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A faithful parse becomes a scraped_job whose description is the paste."""
    monkeypatch.setattr("worker.parse_job_posting_handler.screen_user_text", _allow)

    def parse(*_args: object, **_kwargs: object) -> JobPostingParseRun:
        """Stands in for the agent."""
        return JobPostingParseRun(parsed=_parsed(), usage=RunUsage(input_tokens=40, output_tokens=10))

    monkeypatch.setattr("worker.parse_job_posting_handler.parse_job_posting", parse)

    result = handle_ai_task(build_parse_task(), task_dependencies)

    assert result.status == "completed"
    scraped = result.result["scraped_job"]
    assert scraped["title"] == "AI Engineer"
    assert scraped["company"] == "Acme"
    assert scraped["description"] == AD
    assert scraped["requirements"] == ["5 years of Python"]
    assert scraped["source"] == "pasted_text"
    assert [item.model for item in result.usage] == [
        task_dependencies.settings.job_posting_parse_model,
        "typesafe:jev-latest",
    ]


def test_parse_job_posting_fails_when_the_screen_blocks(
    task_dependencies: TaskDependencies, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A blocked ad is not parsed. Jev usage is still reported."""

    def block(*_args: object, **_kwargs: object) -> ScreenOutcome:
        """Stands in for a Jev call that refuses the ad."""
        return ScreenOutcome(
            allowed=False,
            usage=RunUsage(input_tokens=100, output_tokens=0),
            model="typesafe:jev-latest",
        )

    monkeypatch.setattr("worker.parse_job_posting_handler.screen_user_text", block)
    called = False

    def parse(*_args: object, **_kwargs: object) -> JobPostingParseRun:
        """Must not run."""
        nonlocal called
        called = True
        raise AssertionError("the parse agent should not run")

    monkeypatch.setattr("worker.parse_job_posting_handler.parse_job_posting", parse)

    result = handle_ai_task(build_parse_task(), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == BLOCKED_AD_MESSAGE
    assert called is False
    assert result.usage[0].input_tokens == 100


def test_parse_job_posting_fails_when_the_title_is_not_in_the_ad(
    task_dependencies: TaskDependencies, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A title the model invented fails the task instead of saving a job."""
    monkeypatch.setattr("worker.parse_job_posting_handler.screen_user_text", _allow)

    def parse(*_args: object, **_kwargs: object) -> JobPostingParseRun:
        """Returns a title that is not in the ad."""
        return JobPostingParseRun(
            parsed=_parsed(title="Staff Wizard"), usage=RunUsage(input_tokens=1, output_tokens=1)
        )

    monkeypatch.setattr("worker.parse_job_posting_handler.parse_job_posting", parse)

    result = handle_ai_task(build_parse_task(), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == COULD_NOT_READ_MESSAGE


def test_parse_job_posting_fails_when_a_bullet_is_invented(
    task_dependencies: TaskDependencies, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A requirement that is not in the ad fails the task."""
    monkeypatch.setattr("worker.parse_job_posting_handler.screen_user_text", _allow)

    def parse(*_args: object, **_kwargs: object) -> JobPostingParseRun:
        """Returns a bullet that is not in the ad."""
        return JobPostingParseRun(
            parsed=_parsed(requirements=["10 years of COBOL"]),
            usage=RunUsage(input_tokens=1, output_tokens=1),
        )

    monkeypatch.setattr("worker.parse_job_posting_handler.parse_job_posting", parse)

    result = handle_ai_task(build_parse_task(), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == COULD_NOT_READ_MESSAGE


def test_parse_job_posting_fails_when_retries_are_exhausted(
    task_dependencies: TaskDependencies, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A model that never returns a valid parse fails with the same message."""
    monkeypatch.setattr("worker.parse_job_posting_handler.screen_user_text", _allow)

    def parse(*_args: object, **_kwargs: object) -> JobPostingParseRun:
        """The agent gave up after its output retries."""
        raise UnexpectedModelBehavior("retries exhausted")

    monkeypatch.setattr("worker.parse_job_posting_handler.parse_job_posting", parse)

    result = handle_ai_task(build_parse_task(), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == COULD_NOT_READ_MESSAGE
