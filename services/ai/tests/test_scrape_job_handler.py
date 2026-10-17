"""
Description: Tests for the scrape_job handler against a fake LinkedIn (httpx.MockTransport), with
the sorting agent on TestModel.
Index:
    - load_linkedin_fixture: a synthetic LinkedIn guest job page from tests/fixtures/linkedin
    - build_scrape_job_task: a scrape_job task for a URL
    - test_*: one behavior per test
"""

from pathlib import Path
from uuid import uuid4

import httpx
import pytest
from pydantic_ai import capture_run_messages
from pydantic_ai.messages import UserPromptPart
from pydantic_ai.models.test import TestModel

from agents.job_requirements_sorting_agent import job_requirements_sorting_agent
from schemas.scraped_job_posting import ScrapedJobPosting
from scrapers.linkedin.fetch_linkedin_job import GUEST_JOB_URL
from tests.fakes import FakeJobSite
from worker.queue_messages import AiTaskMessage
from worker.scrape_job_handler import (
    POSTING_NOT_FOUND_MESSAGE,
    UNREADABLE_PAGE_MESSAGE,
    UNSUPPORTED_URL_MESSAGE,
)
from worker.task_dependencies import TaskDependencies
from worker.task_handlers import handle_ai_task

FIXTURES = Path(__file__).parent / "fixtures" / "linkedin"


def load_linkedin_fixture(name: str) -> str:
    """Reads a fixture HTML file."""
    return (FIXTURES / f"{name}.html").read_text()


def build_scrape_job_task(url: str) -> AiTaskMessage:
    """Builds a scrape_job task for the URL."""
    return AiTaskMessage(
        ai_task_id=uuid4(), user_id=uuid4(), task_type="scrape_job", input={"url": url}
    )


def test_scrapes_a_posting_with_headings(
    task_dependencies: TaskDependencies, fake_job_site: FakeJobSite
) -> None:
    """The top card maps onto the posting and headings split requirements; no LLM, no usage."""
    fake_job_site.pages[GUEST_JOB_URL.format(job_id="4001")] = load_linkedin_fixture(
        "job_with_headings"
    )

    result = handle_ai_task(
        build_scrape_job_task(
            "https://www.linkedin.com/jobs/view/senior-backend-engineer-at-northwind-4001?trk=abc"
        ),
        task_dependencies,
    )

    assert result.status == "completed"
    assert result.usage == []
    posting = ScrapedJobPosting.model_validate(result.result["scraped_job"])
    assert (posting.title, posting.company, posting.location) == (
        "Senior Backend Engineer",
        "Northwind Payments",
        "Seattle, WA",
    )
    assert posting.source == "linkedin"
    assert posting.source_url == "https://www.linkedin.com/jobs/view/4001/"
    assert posting.requirements == ["5+ years of backend experience", "Strong Python & SQL skills"]
    assert posting.nice_to_haves == ["Payments experience"]
    assert posting.requirements_sorted_by == "headings"
    assert posting.description.startswith("Northwind builds payment rails.\n\nResponsibilities")
    assert "Seniority level" not in posting.description


def test_sorts_bullets_with_the_agent_when_headings_are_missing(
    task_dependencies: TaskDependencies, fake_job_site: FakeJobSite, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The agent sees numbered bullets; its numbers choose the bullets, and its usage is reported."""
    fake_job_site.pages[GUEST_JOB_URL.format(job_id="4002")] = load_linkedin_fixture(
        "job_without_headings"
    )
    agent_output = {"requirement_numbers": [2], "nice_to_have_numbers": [3]}
    from screening.screen_user_text import ScreenOutcome

    monkeypatch.setattr("worker.scrape_job_handler.screen_user_text", lambda *_args, **_kwargs: ScreenOutcome(True))

    with (
        capture_run_messages() as messages,
        job_requirements_sorting_agent.override(model=TestModel(custom_output_args=agent_output)),
    ):
        result = handle_ai_task(
            build_scrape_job_task("https://www.linkedin.com/jobs/search/?currentJobId=4002"),
            task_dependencies,
        )

    posting = ScrapedJobPosting.model_validate(result.result["scraped_job"])
    assert (posting.company, posting.location) == ("Woodgrove Bank", "Toronto, ON, Canada")
    assert posting.requirements == ["4+ years operating Kubernetes"]
    assert posting.nice_to_haves == ["Go experience is a plus"]
    assert posting.requirements_sorted_by == "llm"
    [user_prompt] = [part for part in messages[0].parts if isinstance(part, UserPromptPart)]
    assert user_prompt.content == (
        "1. Run our Kubernetes clusters\n2. 4+ years operating Kubernetes\n3. Go experience is a plus"
    )
    [model_usage] = result.usage
    assert model_usage.model == task_dependencies.settings.job_requirements_sorting_model
    assert model_usage.cost_microdollars > 0


@pytest.mark.parametrize(
    "url",
    ["https://www.indeed.com/viewjob?jk=abc123", "https://www.linkedin.com/jobs/"],
)
def test_unsupported_urls_fail_without_fetching(
    url: str, task_dependencies: TaskDependencies, fake_job_site: FakeJobSite
) -> None:
    """Other sites and LinkedIn pages that aren't one job fail with a clear message."""
    result = handle_ai_task(build_scrape_job_task(url), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == UNSUPPORTED_URL_MESSAGE
    assert fake_job_site.requested_urls == []


def test_missing_posting_fails_with_message(task_dependencies: TaskDependencies) -> None:
    """A 404 (closed posting) is a user-facing failure."""
    result = handle_ai_task(
        build_scrape_job_task("https://www.linkedin.com/jobs/view/999"), task_dependencies
    )

    assert result.status == "failed"
    assert result.error_message == POSTING_NOT_FOUND_MESSAGE


def test_page_without_a_job_fails_with_message(
    task_dependencies: TaskDependencies, fake_job_site: FakeJobSite
) -> None:
    """A 200 page with no job title (a login wall) fails instead of saving an empty job."""
    fake_job_site.pages[GUEST_JOB_URL.format(job_id="4003")] = "<html><h1>Sign in</h1></html>"

    result = handle_ai_task(
        build_scrape_job_task("https://www.linkedin.com/jobs/view/4003"), task_dependencies
    )

    assert result.status == "failed"
    assert result.error_message == UNREADABLE_PAGE_MESSAGE


@pytest.mark.parametrize("status", [429, 503, 999])
def test_throttling_and_server_errors_propagate_for_a_retry(
    status: int, task_dependencies: TaskDependencies, fake_job_site: FakeJobSite
) -> None:
    """Rate limits, 5xx, and LinkedIn's 999 raise, so SQS can redeliver the task later."""
    fake_job_site.statuses[GUEST_JOB_URL.format(job_id="4001")] = status

    with pytest.raises(httpx.HTTPStatusError):
        handle_ai_task(
            build_scrape_job_task("https://www.linkedin.com/jobs/view/4001"), task_dependencies
        )
