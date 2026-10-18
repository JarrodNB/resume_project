"""Check job input screening at the classifier and generation provider boundaries."""

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage

from agents.job_requirements_sorting_agent import job_requirements_sorting_agent
from agents.parse_job_posting_agent import parse_job_posting_agent
from agents.user_text_screen_agent import user_text_screen_agent
from scrapers.linkedin.fetch_linkedin_job import GUEST_JOB_URL
from tests.test_parse_job_posting_handler import AD, _parsed, build_parse_task
from tests.test_scrape_job_handler import build_scrape_job_task, load_linkedin_fixture
from worker.task_handlers import handle_ai_task

pytestmark = pytest.mark.real_guardrail


def test_unnamed_employer_import_needs_one_parse_request(task_dependencies, classifier):
    """A real agent accepts null company and emits it without a retry."""
    text = "AI Engineer\nRequirements\n- 5 years of Python"
    requests = []

    def answer(messages, info):
        requests.append(messages)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {
            "title": "AI Engineer", "company": None,
            "requirements": ["5 years of Python"],
        })])

    with parse_job_posting_agent.override(model=FunctionModel(answer)):
        result = handle_ai_task(build_parse_task(text), task_dependencies)

    assert result.status == "completed", result.error_message
    assert result.result["scraped_job"]["company"] is None
    assert result.result["scraped_job"]["requirements"] == ["5 years of Python"]
    assert len(requests) == 1
    assert classifier == [text]


@pytest.fixture
def classifier(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-key")
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", "2000")
    seen = []

    def classify(messages, info):
        text = messages[-1].parts[-1].content
        seen.append(text)
        if "outage" in text:
            raise RuntimeError("Synthetic Jev outage")
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {
                "prompt_injection": "attack" in text, "harmful_request": False,
            })], model_name="jev-1.13.0", usage=RunUsage(input_tokens=10),
            provider_details={"confidence": {"prompt_injection": 1., "harmful_request": 1.}},
        )

    with user_text_screen_agent.override(model=FunctionModel(classify)):
        yield seen


def test_short_pasted_ad_is_screened_once(task_dependencies, classifier):
    """The parse prompt's trusted fence does not cause another classifier request."""
    with parse_job_posting_agent.override(model=TestModel(custom_output_args=_parsed().model_dump())):
        result = handle_ai_task(build_parse_task(), task_dependencies)
    assert result.status == "completed"
    assert classifier == [AD]


def test_large_scraped_sorting_source_uses_shared_chunks(task_dependencies, fake_job_site, classifier):
    """Scraped bullets receive one complete chunked pass only when sorting needs an LLM."""
    html = load_linkedin_fixture("job_without_headings").replace(
        "Run our Kubernetes clusters", "Operate services. " * 180,
    )
    fake_job_site.pages[GUEST_JOB_URL.format(job_id="4002")] = html
    with job_requirements_sorting_agent.override(model=TestModel(custom_output_args={
        "requirement_numbers": [2], "nice_to_have_numbers": [3],
    })):
        result = handle_ai_task(
            build_scrape_job_task("https://www.linkedin.com/jobs/view/4002"), task_dependencies,
        )
    assert result.status == "completed"
    assert len(classifier) == 2
    assert all(len(chunk) <= 2000 for chunk in classifier)
    assert classifier[0][-300:] == classifier[1][:300]


@pytest.mark.parametrize("failure", ["attack", "outage", "missing_key"])
def test_pasted_ad_failure_prevents_generation_and_keeps_partial_usage(
    failure, task_dependencies, classifier, monkeypatch,
):
    """Required late-chunk blocks/outages and missing credentials fail before parsing."""
    if failure == "missing_key":
        monkeypatch.delenv("TYPESAFE_API_KEY")
    source = AD + (" x" * 1100) + failure

    def must_not_generate(*_args):
        raise AssertionError("Unsafe input reached generation")

    with parse_job_posting_agent.override(model=FunctionModel(must_not_generate)):
        result = handle_ai_task(build_parse_task(source), task_dependencies)
    assert result.status == "failed"
    if failure == "attack":
        assert "unsafe" in result.error_message
        assert sum(entry.input_tokens for entry in result.usage) == 20
    elif failure == "outage":
        assert "couldn't check" in result.error_message
        assert result.usage[0].input_tokens == 10
    else:
        assert "couldn't check" in result.error_message
        assert result.usage == [] and classifier == []


@pytest.mark.parametrize("failure", ["attack", "outage"])
def test_scraped_sorting_failure_prevents_generation_and_keeps_usage(
    failure, task_dependencies, fake_job_site, classifier,
):
    """Required scraped sorting inputs fail closed and keep completed classifier charges."""
    fake_job_site.pages[GUEST_JOB_URL.format(job_id="4002")] = load_linkedin_fixture(
        "job_without_headings",
    ).replace("Go experience is a plus", failure)

    def must_not_generate(*_args):
        raise AssertionError("Unsafe input reached generation")

    with job_requirements_sorting_agent.override(model=FunctionModel(must_not_generate)):
        result = handle_ai_task(
            build_scrape_job_task("https://www.linkedin.com/jobs/view/4002"), task_dependencies,
        )
    assert result.status == "failed"
    assert ("safety check" if failure == "attack" else "unavailable") in result.error_message
    assert len(classifier) == 1
    assert sum(item.input_tokens for item in result.usage) == (10 if failure == "attack" else 0)


def test_deterministic_scrape_makes_no_jev_request(task_dependencies, fake_job_site, classifier):
    """Heading-based extraction does not screen text that never enters a model request."""
    fake_job_site.pages[GUEST_JOB_URL.format(job_id="4001")] = load_linkedin_fixture("job_with_headings")
    result = handle_ai_task(
        build_scrape_job_task("https://www.linkedin.com/jobs/view/4001"), task_dependencies,
    )
    assert result.status == "completed"
    assert classifier == [] and result.usage == []


def test_long_allowed_pasted_ad_does_not_repeat_chunk_pass(task_dependencies, classifier):
    """A long ad's source chunks are sufficient coverage for the fenced generation prompt."""
    source = AD + (" Additional context." * 160)
    with parse_job_posting_agent.override(model=TestModel(custom_output_args=_parsed().model_dump())):
        result = handle_ai_task(build_parse_task(source), task_dependencies)
    assert result.status == "completed"
    assert len(classifier) == 2
    assert classifier[0] + classifier[1][300:] == source
