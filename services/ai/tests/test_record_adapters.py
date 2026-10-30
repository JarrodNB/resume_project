"""Snapshot adapters build the same receipts the older per-domain modules reported."""

import asyncio
from datetime import date

import pytest
from pydantic_ai.usage import RunUsage

from agents.user_text_screen_agent import UserTextScreenRun
from schemas.gap_analysis_context import (
    CareerContext,
    CareerLibrary,
    JobToAnalyze,
    LibraryCertification,
    LibraryEducation,
    LibraryExperience,
    LibraryHighlight,
    LibraryProject,
    LibrarySkill,
)
from schemas.gap_response import GapResponseSnapshot
from schemas.summary_generation import SummarySource
from schemas.user_text_screen import UserTextScreen
from screening.gap_response_fields import screen_gap_response_fields
from screening.job_fields import screen_job_fields
from screening.library_fields import screen_library_fields
from screening.record_adapters import (
    gap_response_records,
    interview_answer_record,
    job_records,
    library_records,
    summary_source_records,
)
from screening.records import ScreenableRecord, screen_records_sync
from screening.screen_user_text import ScreenOutcome
from screening.session import screening_session


@pytest.fixture(autouse=True)
def allow_everything(monkeypatch):
    """Pin Jev and approve every screened blob without provider calls."""
    monkeypatch.setenv("USER_TEXT_SCREEN_MODEL", "typesafe:jev-1.13.0")
    monkeypatch.setenv("USER_TEXT_SCREEN_FALLBACK_MODEL", "typesafe:jev-1.13.0")
    monkeypatch.setattr("screening.screen_user_text.screen_user_message", lambda *_, **__: UserTextScreenRun(
        UserTextScreen(prompt_injection=False, harmful_request=False), "jev-1.13.0",
        {"prompt_injection": 1.0, "harmful_request": 1.0}, RunUsage()))


def library():
    return CareerLibrary(
        summary_record_id="user-1", summary="I build things.", screened_fields=[],
        experiences=[LibraryExperience(id="exp-1", company="Acme", title="Senior Engineer",
            location="Remote", description="Led a team.", start_date=date(2020, 1, 1),
            screened_fields=["company"],
            highlights=[LibraryHighlight(id="hl-1", content="Cut costs 20%"),
                        LibraryHighlight(id="hl-2", content="Approved", screened_fields=["content"])])],
        projects=[LibraryProject(id="proj-1", name="Parser", role="Author", description="  ")],
        educations=[LibraryEducation(id="edu-1", institution="State U", degree="BS", field_of_study="CS")],
        certifications=[LibraryCertification(id="cert-1", name="AWS SA", issuer="AWS",
            issued_date=date(2021, 5, 1), issued_date_precision="month")],
        skills=[LibrarySkill(id="skill-1", name="Python", category="Languages")],
        career_contexts=[CareerContext(id="ctx-1", requirement="Can you work on call? " * 5, response="Yes")],
    )


def new_receipts(records):
    with screening_session() as session:
        assert screen_records_sync(records).allowed
        return {(r.record_type, r.record_id, tuple(sorted(r.fingerprints.items())))
                for r in session.record_screening}


@pytest.mark.parametrize("options", [
    {}, {"include_context_requirements": False},
    {"used_fields": {"experience": {"title", "description"}, "skill": {"name"}, "user": {"summary"}}},
])
def test_library_receipts_match_the_old_module(options):
    with screening_session() as session:
        assert screen_library_fields(library(), lambda _: True, **options)
        old = {(r.record_type, r.record_id, tuple(sorted(r.fingerprints.items())))
               for r in session.library_screening}
    assert old and new_receipts(library_records(library(), **options)) == old


def test_library_records_shapes_and_titles():
    records = {record.record_id: record for record in library_records(library())}
    assert records["user-1"].record_type == "user" and records["user-1"].display_title == "Profile summary"
    role = records["exp-1"]
    assert role.display_title == "Senior Engineer at Acme" and role.approved_fields == {"company"}
    assert set(role.fields) == {"company", "title", "location", "description"}
    assert records["hl-1"].display_title == "Highlight in Senior Engineer at Acme"
    assert records["hl-2"].approved_fields == {"content"}
    assert records["proj-1"].fields == {"name": "Parser", "role": "Author"}
    assert records["edu-1"].display_title == "BS at State U"
    assert "issued_date_precision" not in records["cert-1"].fields
    assert records["skill-1"].display_title == "Python"
    context = records["ctx-1"]
    assert len(context.display_title) <= 60 and context.display_title.endswith("…")


def test_job_receipts_match_the_old_module():
    job = JobToAnalyze(id="job-1", title="Engineer", company="Acme", requirements=["Python", "SQL"],
                       nice_to_haves=["Cloud"], responsibilities=["Hidden"], screened_fields=["company"])
    with screening_session() as session:
        screen_job_fields(job, lambda _: True, approved_sources=[])
        old = {("job", r.job_id, tuple(sorted(r.fields.items()))) for r in session.job_screening}
    [record] = job_records(job)
    assert record.display_title == "Job: Engineer at Acme"
    assert record.fields["requirements"] == ["Python", "SQL"] and "responsibilities" not in record.fields
    assert new_receipts([record]) == old
    extended = job_records(job, fields=("title", "responsibilities"))[0]
    assert set(extended.fields) == {"title", "responsibilities"}


def test_gap_response_receipts_match_the_old_module():
    snapshots = [GapResponseSnapshot(id="gap-1", requirement="Kubernetes", body="Ran clusters"),
                 GapResponseSnapshot(id="gap-2", requirement="SQL", body="Daily", screened_fields=["body"]),
                 GapResponseSnapshot(requirement="Legacy", body="Old answer", screened_fields=["body"])]

    async def allow(_text):
        return ScreenOutcome(True)

    with screening_session() as session:
        asyncio.run(screen_gap_response_fields([(snapshot, snapshot.body) for snapshot in snapshots], allow))
        old = {("gap_response", r.response_id, tuple(sorted(r.fields.items())))
               for r in session.gap_response_screening}
    records = gap_response_records(snapshots)
    assert records[2].record_id is None and records[2].approved_fields == frozenset()
    assert new_receipts(records) == old


def test_interview_answer_record_carries_revisions():
    snapshot = {"question_id": "q-1", "question_revision": 3, "answer_revision": 7,
                "question_text": "Tell me about a hard bug.", "screened_fields": ["question_text"]}
    answer = interview_answer_record(snapshot, "answer_text", "I fixed it.")
    assert (answer.record_type, answer.record_id) == ("interview_question", "q-1")
    assert answer.revision == {"question_revision": 3, "answer_revision": 7}
    assert answer.approved_fields == frozenset()
    assert answer.display_title == "Your answer to: Tell me about a hard bug."
    question = interview_answer_record(snapshot, "question_text", "Tell me about a hard bug.")
    assert question.revision == {"question_revision": 3} and question.approved_fields == {"question_text"}
    assert interview_answer_record(None, "answer_text", "x").record_id is None


def test_summary_sources_group_by_entry_without_ids():
    sources = [SummarySource(label="EXPERIENCES_1_TITLE", text="Engineer"),
               SummarySource(label="EXPERIENCES_1_DESCRIPTION", text="Built things", screened=True),
               SummarySource(label="EXPERIENCES_1_HIGHLIGHT_1", text="Cut costs"),
               SummarySource(label="EDUCATIONS_2_FIELD_OF_STUDY", text="CS"),
               SummarySource(label="SECTION_1_ITEM_2_NAME", text="Python"),
               SummarySource(label="SECTION_1_ITEM_2_HIGHLIGHT_1", text="Shipped"),
               SummarySource(label="EXPERIENCES_2_TITLE", text=" ")]
    records = summary_source_records(sources)
    assert all(record.record_id is None for record in records)
    shapes = [(record.record_type, dict(record.fields), set(record.approved_fields)) for record in records]
    assert shapes == [
        ("experience", {"title": "Engineer", "description": "Built things"}, {"description"}),
        ("experience_highlight", {"content": "Cut costs"}, set()),
        ("education", {"field_of_study": "CS"}, set()),
        ("resume_section", {"name": "Python"}, set()),
        ("resume_section", {"highlight": "Shipped"}, set()),
    ]
    assert new_receipts(records) == set()


@pytest.mark.parametrize("sources", [
    # Same saved row and field under two labels.
    [SummarySource(label="SKILLS_1_NAME", text="INJECT", record_id="s1"),
     SummarySource(label="SKILLS_2_NAME", text="SQL", record_id="s1")],
    # Label fallback: two labels that parse to the same entry and field.
    [SummarySource(label="EXPERIENCES_1_TEXT", text="INJECT"), SummarySource(label="EXPERIENCES_1", text="SQL")],
])
def test_summary_sources_reject_a_repeated_entry_field(sources):
    with pytest.raises(ValueError):
        summary_source_records(sources)


def test_resume_section_type_requires_no_id():
    with pytest.raises(ValueError):
        ScreenableRecord(record_type="resume_section", record_id="1", fields={}, display_title="x")
