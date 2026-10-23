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


def test_nested_roles_are_screened_once_with_their_own_report_ids():
    from schemas.gap_analysis_context import LibraryExperience
    library = CareerLibrary(experiences=[LibraryExperience(
        id="entry", company="Acme", title="Legacy", screened_fields=["company", "title"],
        roles=[{"id": "role", "title": "Engineer", "description": "Built systems", "screened_fields": ["title"]}],
    )])
    requests = []
    with screening_session():
        assert screen_library_fields(library, lambda text: requests.append(text) or True)
        reports = current_session().library_screening
        assert [(r.record_type, r.record_id, r.fields) for r in reports] == [
            ("experience_role", "role", ["description"])]
        assert screen_library_fields(library, lambda _: pytest.fail("already checked"))
    assert "Built systems" in requests[0]
    assert "Engineer" not in requests[0]


def test_legacy_flat_inputs_do_not_report_synthetic_role_approvals():
    from schemas.gap_analysis_context import LibraryExperience
    experience = LibraryExperience(id="entry", company="Acme", title="Engineer")
    assert experience.roles[0].title == "Engineer"
    assert experience.roles[0].id is None
    experience = LibraryExperience.model_validate_json(experience.model_dump_json())
    with screening_session():
        assert screen_library_fields(CareerLibrary(experiences=[experience]), lambda _: True)
        assert [(r.record_type, r.record_id) for r in current_session().library_screening] == [
            ("experience", "entry")]


def test_canonical_projected_title_uses_role_approval_instead_of_stale_parent_approval():
    from schemas.gap_analysis_context import LibraryExperience
    entry = LibraryExperience(id="entry", company="Acme", title="Old", screened_fields=["title"],
                              roles=[{"id": "role", "title": "Current"}])
    assert entry.title == "Current"
    requests = []
    with screening_session():
        assert screen_library_fields(CareerLibrary(experiences=[entry]),
                                     lambda text: requests.append(text) or True,
                                     used_fields={"experience": {"title"}})
        assert [(r.record_type, r.record_id, r.fields) for r in current_session().library_screening] == [
            ("experience_role", "role", ["title"])]
    assert "Current" in requests[0]
    assert "Old" not in requests[0]


def test_grouped_roles_never_expose_stale_flat_title_and_rejection_grants_no_approval():
    from schemas.gap_analysis_context import LibraryExperience
    entry = LibraryExperience(id="entry", company="Acme", title="Stale attribution",
                              roles=[{"id": "r1", "title": "Lead"}, {"id": "r2", "title": "Developer"}])
    assert entry.title == ""
    assert [role.title for role in entry.roles] == ["Lead", "Developer"]
    requests = []
    with screening_session():
        assert not screen_library_fields(CareerLibrary(experiences=[entry]),
                                         lambda text: requests.append(text) or False)
        assert not current_session().library_screening
        assert not current_session().allowed_sources
    assert "Lead" in requests[0] and "Developer" in requests[0]
    assert "Stale attribution" not in requests[0]
