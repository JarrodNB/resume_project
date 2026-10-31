"""Check copied fields, empty sections, and safe failures at the tailoring handler.

These regressions use the complete-draft provider fixture. Section approvals have been
replaced by one completed draft, while contact and library identity remain copied.
"""

from dataclasses import replace
from datetime import date
from uuid import uuid4

import pytest
from pydantic_ai.models.function import FunctionModel

import text_limits
from agents.resume_tailoring_agent import resume_tailoring_agent
from database.tailoring_sources import TailoringSources
from schemas.gap_analysis_context import CareerLibrary, LibraryCertification, LibraryExperience
from schemas.gap_response import GapResponseSnapshot
from tests import test_complete_resume_draft as complete_draft_tests
from worker.queue_messages import AiTaskMessage
from worker.tailor_resume_handler import JOB_NOT_FOUND_MESSAGE
from worker.task_dependencies import TaskDependencies
from worker.task_handlers import handle_ai_task

USER_ID = uuid4()
JOB_ID = uuid4()

generation = complete_draft_tests.generation


def _task(input_data: dict) -> AiTaskMessage:
    """A tailor_resume task for USER_ID's job."""
    return AiTaskMessage(
        ai_task_id=uuid4(), user_id=USER_ID, task_type="tailor_resume", input=input_data
    )


def _base_input(**extra: object) -> dict:
    """Input with a profile snapshot and no sections yet."""
    return {
        "job_id": str(JOB_ID),
        "contact": {"full_name": "Ada Lovelace", "email": "ada@example.com", "links": []},
        "gap_responses": [],
        **extra,
    }


def test_missing_job_fails(task_dependencies: TaskDependencies) -> None:
    """A deleted job fails before any model call."""
    result = handle_ai_task(_task(_base_input()), task_dependencies)

    assert result.status == "failed"
    assert result.error_message == JOB_NOT_FOUND_MESSAGE


def test_complete_draft_copies_contact_without_a_contact_model(generation) -> None:
    """Contact comes from the profile snapshot while other sections are generated."""
    dependencies, _, seen, model = generation
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)

    assert result.status == "completed"
    assert "generation" not in result.model_dump()
    assert result.result["sections"][0]["section_type"] == "contact"
    assert result.result["sections"][0]["content"]["full_name"] == "Synthetic Candidate"
    assert "contact" not in [section for section, _ in seen]


def test_blocked_required_input_fails_and_skips_the_writer(generation, monkeypatch) -> None:
    """Unsafe required text cannot reach a writer or become an editable partial draft."""
    dependencies, context, seen, model = generation
    context.job.title = "attack"
    async def reject(text, *_):
        return complete_draft_tests.UserTextScreenRun(
            complete_draft_tests.UserTextScreen(prompt_injection="attack" in text, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1., "harmful_request": 1.}, complete_draft_tests.RunUsage(input_tokens=7))
    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", reject)
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
    assert result.status == "failed"
    assert "couldn't be used" in result.error_message or "couldn't use" in result.error_message
    assert result.pending_questions == []
    assert result.result is None
    assert seen == []


def test_too_long_prompt_has_a_length_message(generation, monkeypatch: pytest.MonkeyPatch) -> None:
    """Oversized writing input fails with the specific length message and no partial draft."""
    dependencies, _, seen, model = generation
    monkeypatch.setattr(text_limits, "MAX_PROMPT_TEXT", 1)
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
    assert result.status == "failed"
    assert result.error_message == text_limits.TAILOR_PROMPT_TOO_LONG_MESSAGE
    assert result.result is None
    assert seen == []


def test_oversized_library_fails_before_writing(generation) -> None:
    """Saved career text beyond the aggregate cap fails the whole task clearly."""
    dependencies, context, seen, model = generation
    context.career_library.summary = "x" * (text_limits.MAX_SCREENED_TEXT + 1)

    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)

    assert result.status == "failed"
    assert result.error_message == text_limits.TAILOR_LIBRARY_TOO_LONG_MESSAGE
    assert result.result is None
    assert result.usage == []
    assert seen == []


def test_library_near_limit_uses_full_text_when_prompt_fits(generation) -> None:
    """A source with room for screening labels remains available to the summary writer in full."""
    dependencies, context, seen, _ = generation
    context.career_library = CareerLibrary(summary="x" * (text_limits.MAX_SCREENED_TEXT - 100))

    async def generate(messages, info):
        prompt = messages[-1].parts[-1].content
        seen.append(prompt)
        return complete_draft_tests.answer(info, {"nothing_fits": False, "entries": [],
            "summary": {"text": "Experienced engineer.", "source_labels": ["SUMMARY"]}})

    with resume_tailoring_agent.override(model=FunctionModel(generate, model_name="gpt-5-mini")):
        result = handle_ai_task(_task(_base_input()), dependencies)

    assert result.status == "completed", result.error_message
    assert result.result["sections"][1]["section_type"] == "summary"
    assert len(seen) == 1
    assert "[SUMMARY] " + context.career_library.summary in seen[0]


def test_library_at_limit_keeps_labeled_role(generation) -> None:
    """Many valid roles at the cap all remain in the writer's evidence."""
    dependencies, context, seen, _ = generation
    descriptions = ["x" * 4_000 for _ in range(19)] + ["y" * 3_800]
    context.career_library = CareerLibrary(experiences=[LibraryExperience(
        id=f"role-{number}", company="Co", title="Engineer", description=description)
        for number, description in enumerate(descriptions, start=1)])

    async def generate(messages, info):
        section = complete_draft_tests.section_name(messages)
        seen.append((section, messages[-1].parts[-1].content))
        if section == "summary":
            return complete_draft_tests.answer(info, {"nothing_fits": True, "entries": []})
        return complete_draft_tests.answer(info, {"nothing_fits": False,
            "entries": [{"label": f"E{number}", "prose": []}
                        for number in range(1, len(descriptions) + 1)]})

    with resume_tailoring_agent.override(model=FunctionModel(generate, model_name="gpt-5-mini")):
        result = handle_ai_task(_task(_base_input()), dependencies)

    assert result.status == "completed", result.error_message
    experience = next(section for section in result.result["sections"] if section["section_type"] == "experience")
    assert len(experience["content"]["items"]) == len(descriptions)
    assert any(section == "experience" and f"[E20] Engineer at Co: {descriptions[-1]}" in prompt
               for section, prompt in seen)


def test_many_valid_roles_fail_with_library_message_before_writing(generation) -> None:
    """Descriptions at saved-field maximum add up beyond the library cap."""
    dependencies, context, seen, model = generation
    context.career_library = CareerLibrary(experiences=[
        LibraryExperience(id=f"role-{number}", company=f"Company {number}",
            title="Engineer", description="x" * 4_000)
        for number in range(31)
    ])

    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)

    assert result.status == "failed"
    assert result.error_message == text_limits.TAILOR_LIBRARY_TOO_LONG_MESSAGE
    assert result.result is None
    assert seen == []


def test_aggregate_counts_distinct_saved_fields(generation) -> None:
    """Small individual fields can exceed the cap together, including copied identity."""
    dependencies, context, seen, model = generation
    context.career_library = CareerLibrary(
        summary="s" * 40_000,
        experiences=[LibraryExperience(id="role", company="C" * 20_000,
            title="Engineer", location="L" * 20_000)],
    )

    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)

    assert result.status == "failed"
    assert result.error_message == text_limits.TAILOR_LIBRARY_TOO_LONG_MESSAGE
    assert seen == []


def test_large_combined_context_keeps_prompt_limit(generation) -> None:
    """A fitting library can still fail when job and analysis expand the prompt."""
    dependencies, context, seen, model = generation
    context.job.requirements = ["j" * 70_000]
    analysis = {"summary": "a" * 55_000, "assessments": []}
    dependencies = replace(dependencies, read_tailoring_sources=lambda *_: TailoringSources(context, {}, analysis, []))

    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input(gap_analysis=analysis)), dependencies)

    assert result.status == "failed"
    assert result.error_message == text_limits.TAILOR_PROMPT_TOO_LONG_MESSAGE
    assert result.result is None
    assert seen == []


def test_completed_draft_keeps_summary_wording_and_contact(generation) -> None:
    """The model's supported wording stays in the completed draft beside copied contact."""
    dependencies, _, _, model = generation
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
    sections = {section["section_type"]: section["content"] for section in result.result["sections"]}
    assert sections["summary"]["text"] == "Engineer who built Python APIs."
    assert sections["contact"]["full_name"] == "Synthetic Candidate"
    assert any(usage.model == "openai:gpt-5-mini" for usage in result.usage)


def test_empty_projects_are_omitted_without_a_model_call(generation) -> None:
    """No projects skips that writer while the degree still appears in the completed draft."""
    dependencies, context, seen, model = generation
    context.career_library.projects = []
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
    sections = {section["section_type"]: section["content"] for section in result.result["sections"]}
    assert "projects" not in sections
    assert "projects" not in [section for section, _ in seen]
    assert sections["education"]["items"][0]["institution"] == "State University"


def test_education_always_copies_the_library_without_a_writer(generation) -> None:
    """Degrees are copied regardless of whether a writer would consider them relevant."""
    dependencies, _, seen, model = generation
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
    education = next(section for section in result.result["sections"] if section["section_type"] == "education")
    assert education["content"]["items"][0]["institution"] == "State University"
    assert "education" not in [section for section, _ in seen]


def test_one_execution_completes_the_draft_without_approval_state(generation) -> None:
    """A complete result contains every generated section and has no approval questions."""
    dependencies, _, _, model = generation
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
    assert result.status == "completed"
    assert "generation" not in result.model_dump()
    assert result.pending_questions == []
    assert [section["section_type"] for section in result.result["sections"]] == [
        "contact", "summary", "experience", "projects", "education", "skills",
    ]


def test_empty_certifications_skip_without_affecting_skills(generation) -> None:
    """A library without credentials skips that section and still selects skills."""
    dependencies, _, seen, model = generation
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
    sections = {section["section_type"]: section["content"] for section in result.result["sections"]}
    assert "certifications" not in sections
    assert sections["skills"]["items"][0]["name"] == "Python"
    assert "certifications" not in [section for section, _ in seen]


@pytest.mark.parametrize(("precision", "expected"), [("year", "2024"), ("month", "2024-03")])
def test_certification_copy_preserves_identity_and_precision(precision, expected, generation) -> None:
    """Credentials are copied without generation or made-up date detail."""
    dependencies, context, seen, model = generation
    context.career_library.certifications = [LibraryCertification(id="cert", name="AWS Solutions Architect",
        issued_date=date(2024, 3, 1), issued_date_precision=precision)]
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
    certifications = next(section for section in result.result["sections"] if section["section_type"] == "certifications")
    assert certifications["content"]["items"][0]["name"] == "AWS Solutions Architect"
    assert certifications["content"]["items"][0]["issued_date"] == expected
    assert "certifications" not in [section for section, _ in seen]


def test_saved_gap_response_keeps_identity_and_approvals(generation, monkeypatch):
    from pydantic_ai.usage import RunUsage

    from agents.user_text_screen_agent import UserTextScreenRun
    from schemas.user_text_screen import UserTextScreen
    from screening.session import screening_session

    dependencies, _, seen, model = generation
    calls = []
    async def classify(text, *_):
        calls.append(text)
        return UserTextScreenRun(UserTextScreen(prompt_injection=False, harmful_request=False),
            "jev-1.13.0", {"prompt_injection": 1., "harmful_request": 1.}, RunUsage())
    monkeypatch.setattr("tailoring.prepare_resume_draft.screen_user_message_async", classify)
    response_id = str(uuid4())
    context = dependencies.read_gap_analysis_context(USER_ID, JOB_ID)
    responses = [GapResponseSnapshot(id=response_id, requirement="Unique queued requirement",
        body="Unique queued answer", screened_fields=["requirement"])]
    dependencies = replace(dependencies,
        read_tailoring_sources=lambda *_: TailoringSources(context, {}, None, responses))
    with screening_session() as session, resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(_base_input()), dependencies)
        assert result.status == "completed"
        assert [(report.record_id, set(report.fingerprints)) for report in session.record_screening if report.record_type == "gap_response"] == [
            (response_id, {"body"})]
    assert any("Unique queued answer" in text for text in calls)
    assert not any("Unique queued requirement" in text for text in calls)
    assert any("Unique queued answer" in prompt for _, prompt in seen)
    assert all(response_id not in prompt and "screened_fields" not in prompt for _, prompt in seen)


def test_retained_command_ignores_all_obsolete_source_copies(generation):
    """Old queued work uses current owned data without trusting old generated claims."""
    dependencies, _, seen, model = generation
    stale = _base_input(contact={"full_name": "OBSOLETE CONTACT"},
        gap_analysis={"summary": "OBSOLETE COMPARISON", "assessments": []},
        gap_responses=[{"body": "OBSOLETE ANSWER"}])
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task(stale), dependencies)
    assert result.status == "completed"
    assert result.result["sections"][0]["content"]["full_name"] == "Synthetic Candidate"
    assert all("OBSOLETE" not in prompt for _, prompt in seen)


def test_missing_or_foreign_comparison_stops_before_any_generation(generation):
    dependencies, _, seen, model = generation
    dependencies = replace(dependencies, read_tailoring_sources=lambda *_: None)
    with resume_tailoring_agent.override(model=model):
        result = handle_ai_task(_task({"job_id": str(JOB_ID), "analysis_task_id": str(uuid4())}), dependencies)
    assert result.status == "failed"
    assert result.usage == []
    assert seen == []
