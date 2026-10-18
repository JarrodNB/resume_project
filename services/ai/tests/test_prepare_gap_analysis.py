"""Exercise complete preparation using the production screen and offline provider responses."""

from datetime import date

import pytest
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.usage import UsageLimits

from agents.user_text_screen_agent import user_text_screen_agent
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from gap_analysis.prepare_gap_analysis import prepare_gap_analysis
from schemas.gap_analysis_context import LibraryCertification, LibraryFact
from screening.library_inputs import library_source_values
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
    with screening_session(), user_text_screen_agent.override(model=jev_model(requests)):
        result = prepare(context)
        assert prompt_is_covered(result.prompt.text)
        assert not prompt_is_covered(result.prompt.text + " new untrusted text")
    assert requests[1:] == list(library_source_values(context.career_library).sources)
    assert result.prompt == expected
    assert list(result.prompt.evidence) == ["E1", "H1", "H2", "P1", "ED1", "C1", "S1", "S2", "F1"]


def test_complete_library_reuses_import_chunk_policy(monkeypatch):
    monkeypatch.setenv("USER_TEXT_SCREEN_CHUNK_SIZE", "2000")
    context = build_gap_analysis_context()
    context.career_library.summary = "Career background " * 270
    source = context.career_library.summary
    requests = []
    with screening_session(), user_text_screen_agent.override(model=jev_model(requests)):
        result = prepare(context)
        assert prompt_is_covered(result.prompt.text)
    expected_chunks = [source[start:start + 2000] for start in range(0, len(source), 1700)
                       if start == 0 or start + 300 < len(source)]
    chunks = requests[1:1 + len(expected_chunks)]
    assert chunks == expected_chunks
    assert chunks[0] + "".join(chunk[300:] for chunk in chunks[1:]) == source
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
def test_oversize_sources_and_prompt_rejected_before_paid_calls(boundary):
    context = build_gap_analysis_context()
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
    source = context.career_library.summary
    expected_chunks = [source[start:start + 4000] for start in range(0, len(source), 3700)
                       if start == 0 or start + 300 < len(source)]
    chunks = requests[1:1 + len(expected_chunks)]
    assert chunks[0] + "".join(chunk[300:] for chunk in chunks[1:]) == source
    assert requests[1 + len(expected_chunks):] == list(library_source_values(context.career_library).sources[1:])
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
    assert context.career_library.summary in requests
