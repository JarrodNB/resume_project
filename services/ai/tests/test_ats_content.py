"""Exercise immutable ATS evidence and complete rubric coverage without provider calls."""

import pytest

from schemas.ats_content import CHECK_KEYS, Assessment, validate_assessment


def test_rejects_fabricated_evidence():
    assessment = Assessment(
        requirements=[],
        checks=[
            {
                "key": key,
                "status": "pass",
                "evidence": [{"section_id": "s1", "excerpt": "Invented"}],
                "explanation": "Clear",
                "suggested_action": "",
            }
            for key in CHECK_KEYS
        ],
    )
    with pytest.raises(ValueError, match="evidence"):
        validate_assessment(assessment, [{"id": "s1", "content": "Real work"}], [])


def test_requires_every_requirement_and_check_once():
    with pytest.raises(ValueError, match="coverage"):
        validate_assessment(Assessment(requirements=[], checks=[]), [], [{"id": "r1"}])


from types import SimpleNamespace
from uuid import UUID, uuid4

from schemas.ats_content import Snapshot
from worker.ats_content_handler import handle_ats_content_task
from worker.queue_messages import AiTaskMessage


def test_mismatched_snapshot_fails_without_generation():
    resume_id = uuid4()
    snapshot = Snapshot(
        resume_id=str(resume_id),
        content_snapshot=[],
        job_snapshot=None,
        content_fingerprint="old",
        job_fingerprint=None,
        rubric_version="1",
    )
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="check_resume_content",
        input={
            "run_id": str(uuid4()),
            "resume_id": str(resume_id),
            "content_fingerprint": "new",
            "job_fingerprint": None,
            "rubric_version": "1",
        },
    )
    seen = []

    def read(user_id, run_id):
        seen.append((user_id, run_id))
        return snapshot

    result = handle_ats_content_task(task, SimpleNamespace(read_ats_snapshot=read))
    assert result.status == "failed"
    assert seen == [(task.user_id, UUID(task.input["run_id"]))]


def test_valid_exact_evidence_is_accepted():
    output = Assessment(
        requirements=[
            {
                "requirement_id": "r1",
                "status": "covered",
                "evidence": [{"section_id": "s1", "excerpt": "Python"}],
                "explanation": "Python is listed.",
                "suggested_action": "",
            }
        ],
        checks=[
            {
                "key": key,
                "status": "pass",
                "evidence": [{"section_id": "s1", "excerpt": "Python"}],
                "explanation": "Clear",
                "suggested_action": "",
            }
            for key in CHECK_KEYS
        ],
    )
    assert (
        validate_assessment(output, [{"id": "s1", "content": {"text": "Python"}}], [{"id": "r1"}])
        == output
    )


def test_handler_returns_versioned_assessment(task_dependencies, monkeypatch):
    from screening.screen_user_text import ScreenOutcome

    monkeypatch.setattr(
        "worker.ats_content_handler.screen_user_text",
        lambda *args, **kwargs: ScreenOutcome(allowed=True),
    )
    from dataclasses import replace

    from pydantic_ai.models.test import TestModel

    from agents.ats_content_agent import ats_content_agent

    snapshot = Snapshot(
        resume_id=str(uuid4()),
        content_snapshot=[{"id": "s1", "title": "Skills", "content": {"text": "Python"}}],
        job_snapshot=None,
        content_fingerprint="content",
        job_fingerprint=None,
        rubric_version="1",
    )
    output = {
        "requirements": [],
        "checks": [
            {
                "key": key,
                "status": "pass",
                "evidence": [{"section_id": "s1", "excerpt": "Python"}],
                "explanation": "Clear",
                "suggested_action": "",
            }
            for key in CHECK_KEYS
        ],
    }
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="check_resume_content",
        input={
            "run_id": str(uuid4()),
            "resume_id": snapshot.resume_id,
            "content_fingerprint": "content",
            "job_fingerprint": None,
            "rubric_version": "1",
        },
    )
    monkeypatch.setattr("agents.ats_content_agent.generative_model", lambda *args: TestModel(custom_output_args=output))
    deps = replace(task_dependencies, read_ats_snapshot=lambda user_id, run_id: snapshot)
    with ats_content_agent.override(model=TestModel(custom_output_args=output)):
        result = handle_ats_content_task(task, deps)
    assert result.status == "completed"
    assert result.result["content_fingerprint"] == "content"
    assert len(result.result["checks"]) == 10

def test_contact_usability_does_not_accept_invalid_or_absent_channel():
    from schemas.ats_contact import contact_usability
    assert contact_usability([]).status == "fail"
    assert contact_usability([{"id": "s1", "section_type": "contact", "title": "Contact",
                               "content": {"email": "not-an-email", "phone": ""}}]).status == "fail"
    assert contact_usability([{"id": "s1", "section_type": "contact", "title": "Contact",
                               "content": {"email": "alex@example.test"}}]).status == "pass"


def test_evidence_cannot_quote_internal_section_identifiers():
    output = Assessment(requirements=[], checks=[
        {"key": key, "status": "pass", "evidence": [{"section_id": "secret-id", "excerpt": "secret-id"}],
         "explanation": "Clear", "suggested_action": ""} for key in CHECK_KEYS])
    with pytest.raises(ValueError, match="evidence"):
        validate_assessment(output, [{"id": "secret-id", "content": {"text": "Actual text"}}], [])


def test_covered_requirement_needs_evidence():
    output = Assessment(requirements=[
        {"requirement_id": "r1", "status": "covered", "evidence": [],
         "explanation": "Claimed", "suggested_action": ""}], checks=[
        {"key": key, "status": "unavailable", "evidence": [],
         "explanation": "No text", "suggested_action": ""} for key in CHECK_KEYS])
    with pytest.raises(ValueError, match="require evidence"):
        validate_assessment(output, [], [{"id": "r1"}])
