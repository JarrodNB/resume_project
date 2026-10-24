"""Exercise exact prompt coverage across real writer and reviewer agent boundaries."""

import asyncio
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputBlocked

from agents.resume_document_agent import resume_document_agent
from agents.resume_editorial_agent import resume_editorial_agent
from agents.user_text_screen_agent import UserTextScreenRun
from documents.resume_measure import ResumeMeasurement
from schemas.user_text_screen import UserTextScreen
from tailoring.generate_resume_draft import ResumeDraftInputError, generate_resume_draft
from tailoring.tailor_resume_input import TailorResumeInput
from tests.fakes import build_gap_analysis_context


@pytest.fixture
def revision_run(monkeypatch, task_dependencies):
    classified, written, reviewed = [], [], []
    block = {"marker": None}

    async def classify(text, *_args):
        classified.append(text)
        blocked = block["marker"] is not None and block["marker"] in text
        return UserTextScreenRun(
            UserTextScreen(prompt_injection=blocked, harmful_request=False),
            "jev-1.13.0",
            {"prompt_injection": 1.0, "harmful_request": 1.0},
            RunUsage(input_tokens=7),
        )

    monkeypatch.setattr("tailoring.generate_resume_draft.screen_user_message_async", classify)
    monkeypatch.setattr("screening.prompt_guardrail._screen_prompt_text", classify)

    async def measure(*_args, **_kwargs):
        return ResumeMeasurement(b"pdf", 1, 0.8)

    monkeypatch.setattr("tailoring.generate_resume_draft.render_and_measure_resume_async", measure)
    context = build_gap_analysis_context()
    context.career_library.summary = "UNCHANGED_LIBRARY_SENTINEL: maintained reliable services."
    context.job.description = "UNCHANGED_JOB_SENTINEL: maintain reliable services."
    deps = replace(task_dependencies, read_gap_analysis_context=lambda *_: context)

    def writer(messages, info):
        written.append(str(messages))
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "markdown": "# Candidate\n\nDRAFT_SENTINEL reliable services.",
                        "sufficient_for_target": True,
                        "sufficiency_explanation": "One relevant page.",
                    },
                )
            ]
        )

    def reviewer(messages, info):
        reviewed.append(str(messages))
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "ready": len(reviewed) > 1,
                        "feedback": "FEEDBACK_SENTINEL clarify the summary.",
                        "sufficient_for_target": True,
                        "sufficiency_explanation": "One page fits.",
                    },
                )
            ]
        )

    def run():
        with (
            resume_document_agent.override(model=FunctionModel(writer)),
            resume_editorial_agent.override(model=FunctionModel(reviewer)),
        ):
            return asyncio.run(
                generate_resume_draft(uuid4(), TailorResumeInput(job_id=uuid4()), deps, usage=[])
            )

    return run, classified, written, reviewed, block


def test_revisions_reuse_approved_sources_and_screen_only_new_payloads(revision_run):
    run, classified, written, reviewed, _ = revision_run
    result = run()
    assert result.drafts == len(written) == len(reviewed) == 2
    assert sum("UNCHANGED_LIBRARY_SENTINEL" in text for text in classified) == 1
    assert sum("UNCHANGED_JOB_SENTINEL" in text for text in classified) == 1
    new_payloads = [
        text for text in classified if "DRAFT_SENTINEL" in text or "FEEDBACK_SENTINEL" in text
    ]
    assert any("DRAFT_SENTINEL" in text for text in new_payloads)
    assert any("FEEDBACK_SENTINEL" in text for text in new_payloads)
    assert all(
        "UNCHANGED_LIBRARY_SENTINEL" not in text and "UNCHANGED_JOB_SENTINEL" not in text
        for text in new_payloads
    )


@pytest.mark.parametrize(
    "marker,expected_writers,expected_reviewers",
    [("DRAFT_SENTINEL", 1, 0), ("FEEDBACK_SENTINEL", 1, 1)],
)
def test_rejected_generated_payload_blocks_the_next_provider(
    revision_run, marker, expected_writers, expected_reviewers
):
    run, _classified, written, reviewed, block = revision_run
    block["marker"] = marker
    with pytest.raises((ResumeDraftInputError, InputBlocked)):
        run()
    assert len(written) == expected_writers
    assert len(reviewed) == expected_reviewers
