"""Saved field checks reuse only used text and send readable screening input."""

import asyncio

import pytest

from schemas.gap_analysis_context import CareerContext, CareerLibrary, LibraryExperience
from screening.library_fields import screen_library_fields, screen_library_fields_async
from screening.session import current_session, screening_session


def test_checks_only_unapproved_used_fields_and_reports_success():
    library = CareerLibrary(career_contexts=[CareerContext(id="career_context", requirement="On call", response="Weekly",
                                             screened_fields=["response"])])
    requests = []
    with screening_session():
        outcome = screen_library_fields(library, lambda text: requests.append(text) or True)
        assert outcome
        assert current_session().library_screening[0].fields == ["requirement"]
    assert "On call" in requests[0]
    assert "Weekly" not in requests[0]
    assert "screened_fields" not in library.model_dump_json()


def test_unused_fields_are_not_checked_and_reuse_does_not_call_classifier():
    library = CareerLibrary(career_contexts=[CareerContext(id="career_context", requirement="On call", response="Weekly",
                                             screened_fields=["response"])])
    with screening_session():
        assert screen_library_fields(library, lambda _: pytest.fail("unexpected check"),
                                     include_context_requirements=False)
        assert not current_session().library_screening


def test_rejected_batch_does_not_approve_partial_fields():
    library = CareerLibrary(career_contexts=[CareerContext(id="career_context", requirement="On call", response="Weekly")])
    with screening_session():
        assert not screen_library_fields(library, lambda _: False)
        assert not current_session().library_screening


def test_projected_approval_does_not_cover_full_library_with_unchecked_fields():
    from screening.session import current_session
    library = CareerLibrary(career_contexts=[CareerContext(id="career_context", requirement="On call", response="Weekly")])
    with screening_session():
        assert screen_library_fields(library, lambda _: True,
                                     used_fields={"career_context": {"response"}})
        assert not current_session().allowed_sources
        assert current_session().library_screening[0].fields == ["response"]


def test_unchecked_fields_are_plain_text_with_distinct_field_boundaries():
    library = CareerLibrary(experiences=[LibraryExperience(
        id="secret-record-id", company="Acme", title="Engineer",
        description="Built a parser.\nHandled quoted \"inputs\".",
        screened_fields=["company"],
    )], career_contexts=[CareerContext(id="secret-fact-id", requirement="On call", response="Weekly")])
    requests = []

    with screening_session():
        assert screen_library_fields(library, lambda text: requests.append(text) or True)
        assert [(report.record_type, report.fields) for report in current_session().library_screening] == [
            ("experience", ["title", "description"]),
            ("career_context", ["requirement", "response"]),
        ]

    prompt = requests[0]
    assert "Engineer" in prompt
    assert "Built a parser.\nHandled quoted \"inputs\"." in prompt
    assert "On call" in prompt and "Weekly" in prompt
    assert prompt.index("title:") < prompt.index("description:") < prompt.index("requirement:") < prompt.index("response:")
    assert "Acme" not in prompt
    assert "secret-record-id" not in prompt and "secret-fact-id" not in prompt
    assert "[{" not in prompt and "\\n" not in prompt


def test_async_screening_uses_same_readable_input_and_keeps_fail_closed():
    library = CareerLibrary(career_contexts=[CareerContext(id="fact-id", requirement="On call", response="Weekly")])
    requests = []

    async def reject(text):
        requests.append(text)
        return False

    with screening_session():
        assert not asyncio.run(screen_library_fields_async(library, reject))
        assert not current_session().library_screening
    assert "requirement:\nOn call" in requests[0]
    assert "response:\nWeekly" in requests[0]
    assert "fact-id" not in requests[0]
