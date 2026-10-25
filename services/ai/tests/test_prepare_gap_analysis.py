"""Exercise complete preparation using the production screen and offline provider responses."""

from datetime import date

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import UsageLimits

from agents.user_text_screen_agent import user_text_screen_agent
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from gap_analysis.prepare_gap_analysis import prepare_gap_analysis
from schemas.gap_analysis_context import LibraryCertification, LibraryFact
from screening.session import prompt_is_covered, screening_session
from tests.fakes import build_gap_analysis_context
from tests.test_gap_context_screening import jev_model

TODAY = date(2026, 10, 18)


def prepare(context):
    return prepare_gap_analysis(context, today=TODAY, screen_model="typesafe:jev-1.13.0", timeout_seconds=5)


def test_every_library_value_is_screened_and_preserved():
    context = build_gap_analysis_context()
    context.career_library.certifications = [LibraryCertification(
        id="certification", name="Credential", issuer="Issuer", description="Description",
        credential_url="https://example.test/credential", issued_date=date(2020, 1, 1),
    )]
    context.career_library.facts = [LibraryFact(id="fact", requirement="On call", response="Weekly")]
    requests = []
    expected = build_gap_analysis_prompt(context, TODAY)
    with screening_session() as session, user_text_screen_agent.override(model=jev_model(requests)):
        result = prepare(context)
        assert prompt_is_covered(result.prompt.text)
        assert not prompt_is_covered(result.prompt.text + " new untrusted text")
        assert set(session.job_screening[0].fields) == {"title", "company", "requirements", "nice_to_haves"}
    assert len(requests) == 2
    assert "On call" in requests[1]
    assert "screened_fields" not in requests[1]
    assert result.prompt == expected
    assert list(result.prompt.evidence) == ["E1", "H1", "H2", "P1", "ED1", "C1", "S1", "S2", "F1"]


def test_complete_library_reuses_import_chunk_policy(monkeypatch):
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", "2000")
    context = build_gap_analysis_context()
    context.career_library.summary = "Career background " * 270
    requests = []
    with screening_session(), user_text_screen_agent.override(model=jev_model(requests)):
        result = prepare(context)
        assert prompt_is_covered(result.prompt.text)
    chunks = requests[1:]
    screened = chunks[0] + "".join(chunk[300:] for chunk in chunks[1:])
    assert chunks == [screened[start:start + 2000] for start in range(0, len(screened), 1700)
                      if start == 0 or start + 300 < len(screened)]
    assert context.career_library.summary in screened
    assert sum(item.input_tokens for item in result.usage) == len(requests) * 100


@pytest.mark.parametrize("failure", ["block", "outage", "deadline"])
def test_later_library_chunk_failure_retains_completed_usage(monkeypatch, failure):
    from pydantic_ai.models.function import FunctionModel

    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", "2000")
    context = build_gap_analysis_context()
    context.career_library.summary = "x" * 5000
    requests = []
    benign = jev_model(requests)
    clock = [0.]
    if failure == "deadline":
        monkeypatch.setattr("screening.screen_user_text.monotonic", lambda: clock[0])

    def respond(messages, info):
        if len(requests) == 2 and failure == "outage":
            raise RuntimeError("Synthetic provider outage")
        response = benign.function(messages, info)
        if len(requests) == 2 and failure == "deadline":
            clock[0] = 10.
        if len(requests) == 3 and failure == "block":
            response.parts[0].args = {"prompt_injection": True, "harmful_request": False}
        return response

    with screening_session(), user_text_screen_agent.override(model=FunctionModel(respond)):
        result = prepare(context)
    assert result.prompt is None
    assert result.error_message
    assert sum(item.input_tokens for item in result.usage) == (300 if failure == "block" else 200)


@pytest.mark.parametrize("boundary", ["library", "job", "prompt"])
@pytest.mark.parametrize("approved_job", [False, True])
def test_oversize_sources_and_prompt_rejected_before_paid_calls(boundary, approved_job):
    context = build_gap_analysis_context()
    if approved_job:
        context.job.screened_fields = ["title", "company", "requirements", "nice_to_haves"]
    if boundary == "library":
        context.career_library.summary = "x" * 80_000
    elif boundary == "job":
        context.job.requirements = ["x" * 80_000]
    else:
        context.job.requirements = ["x" * 70_000]
        context.career_library.summary = "x" * 70_000
    requests = []
    with user_text_screen_agent.override(model=jev_model(requests)):
        result = prepare(context)
    assert result.prompt is None
    assert result.error_message
    assert not requests
    assert not result.usage


def test_library_at_exact_source_cap_is_not_truncated(monkeypatch):
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", "4000")
    context = build_gap_analysis_context()
    context.career_library.summary = ""
    overhead = len(context.career_library.model_dump_json(exclude_none=True))
    context.career_library.summary = "x" * (80_000 - overhead)
    requests = []
    with user_text_screen_agent.override(model=jev_model(requests)):
        result = prepare(context)
    assert result.prompt is not None
    chunks = requests[1:]
    assert context.career_library.summary in chunks[0] + "".join(chunk[300:] for chunk in chunks[1:])
    assert result.prompt.text.count("x") >= 80_000 - overhead


def test_jev_usage_limit_propagates_instead_of_returning_partial_prompt(monkeypatch):
    monkeypatch.setattr("agents.user_text_screen_agent.agent_usage_limits", lambda _: UsageLimits(output_tokens_limit=0))
    requests = []
    with user_text_screen_agent.override(model=jev_model(requests)), pytest.raises(UsageLimitExceeded):
        prepare(build_gap_analysis_context())
    assert len(requests) == 1


def test_whole_library_skips_short_note_phrase_filter():
    context = build_gap_analysis_context()
    context.career_library.summary = "Research on the phrase ignore previous instructions."
    requests = []
    with user_text_screen_agent.override(model=jev_model(requests)):
        result = prepare(context)
    assert result.prompt is not None
    assert len(requests) == 2


def test_later_analysis_reuses_saved_checks_but_still_screens_job():
    context = build_gap_analysis_context()
    requests = []
    with screening_session() as session, user_text_screen_agent.override(model=jev_model(requests)):
        first = prepare(context)
        assert first.prompt
        reports = session.library_screening
    for report in reports:
        for collection in (context.career_library.experiences, context.career_library.projects,
                           context.career_library.educations, context.career_library.skills):
            for record in collection:
                if record.id == report.record_id:
                    record.screened_fields = report.fields
                for highlight in getattr(record, "highlights", []):
                    if highlight.id == report.record_id:
                        highlight.screened_fields = report.fields
    context.career_library.screened_fields = ["summary"]
    requests.clear()
    with screening_session() as session, user_text_screen_agent.override(model=jev_model(requests)):
        second = prepare(context)
        assert prompt_is_covered(second.prompt.text)
        assert not session.library_screening
    assert second.prompt == first.prompt
    assert len(requests) == 1


def test_saved_job_approvals_skip_job_classification_and_keep_exact_prompt_coverage():
    from schemas.gap_analysis_context import JobToAnalyze

    context = build_gap_analysis_context()
    context.job = JobToAnalyze(**context.job.model_dump(),
        screened_fields=["title", "company", "requirements", "nice_to_haves"])
    requests = []
    with screening_session(), user_text_screen_agent.override(model=jev_model(requests)):
        result = prepare(context)
        assert result.prompt is not None
        assert prompt_is_covered(result.prompt.text)
    assert len(requests) == 1
    assert "screened_fields" not in result.prompt.text
