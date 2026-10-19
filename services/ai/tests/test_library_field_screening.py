"""Saved field checks reuse only the fields read by the current feature."""

import pytest

from schemas.gap_analysis_context import CareerLibrary, LibraryFact
from screening.library_fields import screen_library_fields
from screening.session import current_session, screening_session


def test_checks_only_unapproved_used_fields_and_reports_success():
    library = CareerLibrary(facts=[LibraryFact(id="fact", requirement="On call", response="Weekly",
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
    library = CareerLibrary(facts=[LibraryFact(id="fact", requirement="On call", response="Weekly",
                                             screened_fields=["response"])])
    with screening_session():
        assert screen_library_fields(library, lambda _: pytest.fail("unexpected check"),
                                     include_fact_requirements=False)
        assert not current_session().library_screening


def test_rejected_batch_does_not_approve_partial_fields():
    library = CareerLibrary(facts=[LibraryFact(id="fact", requirement="On call", response="Weekly")])
    with screening_session():
        assert not screen_library_fields(library, lambda _: False)
        assert not current_session().library_screening


def test_projected_approval_does_not_cover_full_library_with_unchecked_fields():
    from screening.session import current_session
    library = CareerLibrary(facts=[LibraryFact(id="fact", requirement="On call", response="Weekly")])
    with screening_session():
        assert screen_library_fields(library, lambda _: True,
                                     used_fields={"library_fact": {"response"}})
        assert not current_session().allowed_sources
        assert current_session().library_screening[0].fields == ["response"]
