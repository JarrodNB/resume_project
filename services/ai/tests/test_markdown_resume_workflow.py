"""Check whole-document tailoring publication and bounded editorial revision offline."""

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from uuid import uuid4

import pytest
from pydantic_ai.usage import RunUsage

from documents.resume_measure import ResumeMeasurement, ResumeRenderError
from schemas.resume_document import ResumeDocumentDraft, ResumeEditorialReview
from screening.screen_user_text import ScreenOutcome
from tailoring.generate_resume_draft import ResumeDraftInputError, generate_resume_draft
from tailoring.tailor_resume_input import TailorResumeInput
from tests.fakes import build_gap_analysis_context
from worker.queue_messages import AiTaskMessage
from worker.tailor_resume_handler import handle_tailor_resume_task


def test_handler_publishes_markdown_instead_of_sections(monkeypatch, task_dependencies):
    async def generate(*args, **kwargs):
        return SimpleNamespace(
            markdown="# Candidate\n\n## Summary\nUseful experience.",
            target_pages=1,
            warnings=[],
            measurements={"page_count": 1, "final_page_occupied_share": 0.8},
            editorial_review={"ready": True},
            drafts=1,
        )

    monkeypatch.setattr("worker.tailor_resume_handler.generate_resume_draft", generate)
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="tailor_resume",
        input={"job_id": str(uuid4()), "target_pages": 1},
    )
    result = handle_tailor_resume_task(task, task_dependencies)
    assert result.status == "completed"
    assert result.result["markdown"].startswith("# Candidate")
    assert result.result["target_pages"] == 1
    assert "sections" not in result.result


@pytest.fixture
def workflow(monkeypatch, task_dependencies):
    calls = []

    async def allow(*args, **kwargs):
        return ScreenOutcome(True)

    monkeypatch.setattr("tailoring.generate_resume_draft.screen_user_text_async", allow)

    def reader(user, job):
        calls.append(("read", user, job))
        context = build_gap_analysis_context(responsibilities=["Maintain the entire system"])
        context.career_library.summary = "substantive narrative " * 350
        context.job.description = "Full saved job description with additional context."
        return context

    deps = replace(task_dependencies, read_gap_analysis_context=reader)

    async def write(prompt, settings):
        calls.append(("write", prompt))
        return SimpleNamespace(
            output=ResumeDocumentDraft(
                markdown="# Candidate\n\nUseful work.",
                sufficient_for_target=True,
                sufficiency_explanation="Enough relevant work.",
            ),
            usage=RunUsage(),
            model=settings.resume_tailoring_model,
        )

    async def measure(markdown, **kwargs):
        calls.append(("measure", markdown))
        return ResumeMeasurement(b"fake-pdf", 1, 0.8)

    async def review(prompt, settings):
        calls.append(("review", prompt))
        return SimpleNamespace(
            output=ResumeEditorialReview(
                ready=True,
                feedback="Clear and relevant.",
                sufficient_for_target=True,
                sufficiency_explanation="Enough material.",
            ),
            usage=RunUsage(),
            model=settings.resume_tailoring_model,
        )

    monkeypatch.setattr("tailoring.generate_resume_draft.write_resume_document", write)
    monkeypatch.setattr("tailoring.generate_resume_draft.render_and_measure_resume_async", measure)
    monkeypatch.setattr("tailoring.generate_resume_draft.review_resume_document", review)
    return deps, calls


def run_workflow(deps, target=1):
    return asyncio.run(
        generate_resume_draft(
            uuid4(), TailorResumeInput(job_id=uuid4(), target_pages=target), deps, usage=[]
        )
    )


def test_whole_library_and_job_are_written_measured_then_independently_reviewed(workflow):
    deps, calls = workflow
    result = run_workflow(deps)
    assert [c[0] for c in calls] == ["read", "write", "measure", "review"]
    prompt = calls[1][1]
    assert "Maintain the entire system" in prompt
    assert "Full saved job description with additional context." in prompt
    assert "Acme" in prompt and "PostgreSQL" in prompt
    assert "experiences" in prompt and "educations" in prompt and "skills" in prompt
    assert result.measurements["page_count"] == 1
    assert result.editorial_review["ready"]
    assert result.drafts == 1


def test_revision_receives_measurement_and_separate_review_and_stops_at_three(
    workflow, monkeypatch
):
    deps, calls = workflow

    async def revise(prompt, settings):
        calls.append(("review", prompt))
        return SimpleNamespace(
            output=ResumeEditorialReview(
                ready=False,
                feedback="Remove repetition.",
                sufficient_for_target=True,
                sufficiency_explanation="Enough material.",
            ),
            usage=RunUsage(),
            model=settings.resume_tailoring_model,
        )

    monkeypatch.setattr("tailoring.generate_resume_draft.review_resume_document", revise)
    result = run_workflow(deps)
    writes = [c[1] for c in calls if c[0] == "write"]
    assert len(writes) == result.drafts == 3
    assert "Remove repetition." in writes[1] and "final_page_occupied_share" in writes[1]
    assert "editorial review recommends" in result.warnings[0]


def test_render_failure_never_publishes_or_reviews(workflow, monkeypatch):
    deps, calls = workflow

    async def fail(*args, **kwargs):
        raise ResumeRenderError("Cannot render")

    monkeypatch.setattr("tailoring.generate_resume_draft.render_and_measure_resume_async", fail)
    with pytest.raises(ResumeDraftInputError, match="Cannot render"):
        run_workflow(deps)
    assert not any(c[0] == "review" for c in calls)


def test_review_failure_never_returns_a_draft(workflow, monkeypatch):
    deps, _calls = workflow

    async def fail(*args, **kwargs):
        raise RuntimeError("review provider unavailable")

    monkeypatch.setattr("tailoring.generate_resume_draft.review_resume_document", fail)
    with pytest.raises(RuntimeError, match="review provider"):
        run_workflow(deps)


def test_oversized_final_draft_is_not_published(workflow, monkeypatch):
    deps, _ = workflow

    async def large(*args, **kwargs):
        return ResumeMeasurement(b"pdf", 3, 0.9)

    monkeypatch.setattr("tailoring.generate_resume_draft.render_and_measure_resume_async", large)
    with pytest.raises(ResumeDraftInputError, match="could not fit"):
        run_workflow(deps)


def test_shorter_fallback_has_specific_explanation(workflow, monkeypatch):
    deps, _ = workflow

    async def review(prompt, settings):
        return SimpleNamespace(
            output=ResumeEditorialReview(
                ready=True,
                feedback="Strong shorter draft.",
                sufficient_for_target=False,
                sufficiency_explanation="Only one relevant project supports this role.",
            ),
            usage=RunUsage(),
            model=settings.resume_tailoring_model,
        )

    monkeypatch.setattr("tailoring.generate_resume_draft.review_resume_document", review)
    result = run_workflow(deps, target=2)
    assert result.target_pages == 2 and result.measurements["page_count"] == 1
    assert result.warnings == ["Only one relevant project supports this role."]
    assert result.drafts == 1


def test_two_page_gate_rechecks_current_library_before_any_provider(workflow):
    deps, calls = workflow
    context = build_gap_analysis_context()
    deps = replace(deps, read_gap_analysis_context=lambda *_: context)
    with pytest.raises(ResumeDraftInputError, match="700 words"):
        run_workflow(deps, target=2)
    assert not calls


def test_narrative_gate_counts_only_substantive_fields():
    from schemas.gap_analysis_context import (
        CareerLibrary,
        LibraryExperience,
        LibraryHighlight,
        LibrarySkill,
    )
    from tailoring.library_narrative import narrative_word_count

    library = CareerLibrary(
        summary="café naïve team-work 2026",
        experiences=[
            LibraryExperience(
                id="1",
                company="excluded employer",
                title="excluded title",
                description="built systems",
                highlights=[LibraryHighlight(id="h", content="improved users’ experience")],
            )
        ],
        skills=[LibrarySkill(id="s", name="excluded bare skill")],
    )
    assert narrative_word_count(library) == 8


def test_writer_cancellation_cannot_publish_or_start_review(workflow, monkeypatch):
    deps, calls = workflow
    cancelled = []

    async def wait(*args):
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.append(True)

    monkeypatch.setattr("tailoring.generate_resume_draft.write_resume_document", wait)

    async def run():
        with pytest.raises(TimeoutError):
            async with asyncio.timeout(0.01):
                await generate_resume_draft(
                    uuid4(), TailorResumeInput(job_id=uuid4()), deps, usage=[]
                )

    asyncio.run(run())
    assert cancelled == [True]
    assert not any(c[0] in {"measure", "review"} for c in calls)


def test_shorter_document_cannot_publish_a_contradictory_sufficiency_review(workflow):
    deps, calls = workflow
    with pytest.raises(ResumeDraftInputError, match="reviewed insufficiency"):
        run_workflow(deps, target=2)
    assert len([c for c in calls if c[0] == "review"]) == 3


def test_generated_markdown_fits_saved_document_limit():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ResumeDocumentDraft(
            markdown="x" * 40_001, sufficient_for_target=True, sufficiency_explanation="Enough"
        )
