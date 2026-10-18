"""Grounded evidence selection retains exact saved text and its section ownership."""

from schemas.ats_evidence import build_evidence_catalog


def test_catalog_preserves_all_exact_leaf_text_and_field_context():
    source = (
        "Built reliable Python APIs. " * 30
        + "Led reviews with «pii:opaque-token» and Unicode café."
    )
    sections = [
        {
            "id": "7bfc2d1a-59c8-4e62-9d30-e84a6130519c",
            "position": 0,
            "section_type": "experience",
            "title": "Experience",
            "content": {"items": [{"title": "Engineer", "company": "Acme", "description": source}]},
        }
    ]
    catalog = build_evidence_catalog(sections)
    descriptions = [item for item in catalog if item.field_path == "content.items[0].description"]
    assert "".join(item.excerpt for item in descriptions) == source
    assert len(descriptions) > 1
    assert all(item.section_id == sections[0]["id"] for item in catalog)
    assert len({item.id for item in catalog}) == len(catalog)
    assert any("«pii:opaque-token»" in item.excerpt for item in descriptions)
    assert catalog[0].field_path == "title"


from uuid import uuid4

import pytest

from schemas.ats_content import CHECK_KEYS, Snapshot
from schemas.ats_evidence import AssessmentContext, AssessmentSelection, expand_assessment


def production_context():
    sections = [
        {
            "id": str(uuid4()),
            "position": index,
            "section_type": kind,
            "title": kind.capitalize(),
            "content": {"text": f"Python evidence for section {index}, with exact punctuation."},
        }
        for index, kind in enumerate(
            ("contact", "summary", "experience", "education", "projects", "skills")
        )
    ]
    requirements = [
        {"id": f"{index // 9}:{index % 9}", "text": "Python", "required": True}
        for index in range(27)
    ]
    snapshot = Snapshot(
        resume_id=str(uuid4()),
        content_snapshot=sections,
        job_snapshot={"requirements": requirements},
        content_fingerprint="synthetic",
        job_fingerprint="synthetic",
        rubric_version="ats-v1",
    )
    return AssessmentContext(snapshot=snapshot, evidence_catalog=build_evidence_catalog(sections))


def selection_for(context):
    reference = context.evidence_catalog[-1].id
    return AssessmentSelection(
        requirements=[
            {
                "requirement_id": item["id"],
                "status": "covered",
                "evidence_ids": [reference],
                "explanation": "Supported.",
                "suggested_action": "",
            }
            for item in context.snapshot.job_snapshot["requirements"]
        ],
        checks=[
            {
                "key": key,
                "status": "pass",
                "evidence_ids": [reference],
                "explanation": "Supported.",
                "suggested_action": "",
            }
            for key in CHECK_KEYS
        ],
    )


def test_expands_27_requirements_and_10_checks_to_exact_authoritative_section_text():
    context = production_context()
    selection = selection_for(context)
    assessment = expand_assessment(selection, context)
    expected = context.evidence_catalog[-1]
    assert len(assessment.requirements) == 27
    assert len(assessment.checks) == 10
    for item in [*assessment.requirements, *assessment.checks]:
        assert item.evidence[0].section_id == expected.section_id
        assert item.evidence[0].excerpt == expected.excerpt
        assert "evidence_ids" not in item.model_dump()


def test_unknown_references_fail_before_public_assessment_creation():
    context = production_context()
    selection = selection_for(context)
    selection.requirements[0].evidence_ids = ["invented"]
    with pytest.raises(ValueError, match="Unknown evidence reference"):
        expand_assessment(selection, context)


def test_public_handler_expands_27_requirements_without_provider_written_quotes(
    task_dependencies, monkeypatch
):
    from dataclasses import replace

    from pydantic_ai.models.test import TestModel

    from screening.screen_user_text import ScreenOutcome
    from worker.ats_content_handler import handle_ats_content_task
    from worker.queue_messages import AiTaskMessage

    context = production_context()
    monkeypatch.setattr("pii._detect_spans", lambda _text: [])
    monkeypatch.setattr(
        "worker.ats_content_handler.screen_user_text",
        lambda *_args, **_kwargs: ScreenOutcome(allowed=True),
    )
    selection = selection_for(context)
    monkeypatch.setattr(
        "agents.ats_content_agent.generative_model",
        lambda *_args: TestModel(custom_output_args=selection.model_dump()),
    )
    snapshot = context.snapshot
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="check_resume_content",
        input={
            "run_id": str(uuid4()),
            "resume_id": snapshot.resume_id,
            "content_fingerprint": snapshot.content_fingerprint,
            "job_fingerprint": snapshot.job_fingerprint,
            "rubric_version": snapshot.rubric_version,
        },
    )
    result = handle_ats_content_task(
        task, replace(task_dependencies, read_ats_snapshot=lambda *_args: snapshot)
    )
    assert result.status == "completed"
    assert len(result.result["requirements"]) == 27
    assert len(result.result["checks"]) == 10
    expected = context.evidence_catalog[-1]
    assert result.result["requirements"][0]["evidence"] == [
        {"section_id": expected.section_id, "excerpt": expected.excerpt}
    ]
    assert result.result["checks"][0]["key"] == "contact_usability"
    assert result.result["checks"][0]["status"] == "fail"
    assert "evidence_ids" not in str(result.result)


def test_catalog_expansion_still_rejects_any_nonexact_source_quote():
    context = production_context()
    context.evidence_catalog[-1].excerpt = "A paraphrase that never appeared in saved text"
    with pytest.raises(ValueError, match="Invalid resume evidence"):
        expand_assessment(selection_for(context), context)


def test_complete_augmented_prompt_is_bounded_before_any_provider_call(
    task_dependencies, monkeypatch
):
    from dataclasses import replace

    from pydantic_ai_harness import InputBlocked

    import text_limits
    from worker.ats_content_handler import handle_ats_content_task
    from worker.queue_messages import AiTaskMessage

    context = production_context()
    context.snapshot.content_snapshot[0]["content"]["text"] = "Python " * 10_000
    assert len(context.snapshot.model_dump_json()) < text_limits.MAX_PROMPT_TEXT
    monkeypatch.setattr("pii._detect_spans", lambda _text: [])

    def forbidden(*_args, **_kwargs):
        raise AssertionError("oversized augmented input reached a provider")

    monkeypatch.setattr("worker.ats_content_handler.screen_user_text", forbidden)
    monkeypatch.setattr("agents.ats_content_agent.generative_model", forbidden)
    snapshot = context.snapshot
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="check_resume_content",
        input={
            "run_id": str(uuid4()),
            "resume_id": snapshot.resume_id,
            "content_fingerprint": snapshot.content_fingerprint,
            "job_fingerprint": snapshot.job_fingerprint,
            "rubric_version": snapshot.rubric_version,
        },
    )
    with pytest.raises(InputBlocked):
        handle_ats_content_task(
            task, replace(task_dependencies, read_ats_snapshot=lambda *_args: snapshot)
        )
