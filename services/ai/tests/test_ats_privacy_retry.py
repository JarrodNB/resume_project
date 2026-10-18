"""Retry invented privacy markers while preserving protected-source contact restoration."""

import json
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai.messages import ModelResponse, RetryPromptPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from schemas.ats_content import CHECK_KEYS, Snapshot
from screening.screen_user_text import ScreenOutcome
from worker.ats_content_handler import handle_ats_content_task
from worker.queue_messages import AiTaskMessage


@pytest.mark.parametrize(
    "marker", ["«pii:invented:PERSON:1»", "«pii:broken marker»", "«pii:unfinished"]
)
def test_generated_unknown_marker_retries_then_restores_the_public_result(
    task_dependencies, monkeypatch, marker
):
    name, email = "Jordan Taylor", "jordan.taylor@example.test"

    def detect(text):
        return [
            (text.index(value), text.index(value) + len(value), kind)
            for value, kind in ((name, "PERSON"), (email, "EMAIL_ADDRESS"))
            if value in text
        ]

    monkeypatch.setattr("pii._detect_spans", detect)
    snapshot = Snapshot(
        resume_id=str(uuid4()),
        content_snapshot=[
            {
                "id": str(uuid4()),
                "section_type": "contact",
                "position": 0,
                "title": "Contact",
                "content": {"full_name": name, "email": email},
            }
        ],
        job_snapshot=None,
        content_fingerprint="synthetic",
        job_fingerprint=None,
        rubric_version="ats-v1",
    )
    screened = []

    def screen(source, **kwargs):
        assert name not in source and email not in source
        screened.append(json.loads(source))
        return ScreenOutcome(allowed=True)

    monkeypatch.setattr("worker.ats_content_handler.screen_user_text", screen)
    calls = []

    def respond(messages, info):
        calls.append(messages)
        catalog = screened[0]["evidence_catalog"]
        email_ref = next(item["id"] for item in catalog if item["field_path"] == "content.email")
        output = {
            "requirements": [],
            "checks": [
                {
                    "key": key,
                    "status": "pass",
                    "evidence_ids": [email_ref],
                    "explanation": "No unfinished resume placeholders.",
                    "suggested_action": "",
                    "severity": "info",
                    "absence_reason": None,
                }
                for key in CHECK_KEYS
            ],
        }
        if len(calls) == 1:
            output["checks"][-1]["explanation"] = "Unfinished placeholder " + marker
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)])

    monkeypatch.setattr(
        "agents.ats_content_agent.generative_model", lambda *_: FunctionModel(respond)
    )
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="check_resume_content",
        input={
            "run_id": str(uuid4()),
            "resume_id": snapshot.resume_id,
            "content_fingerprint": snapshot.content_fingerprint,
            "job_fingerprint": None,
            "rubric_version": snapshot.rubric_version,
        },
    )
    result = handle_ats_content_task(
        task, replace(task_dependencies, read_ats_snapshot=lambda *_: snapshot)
    )
    assert result.status == "completed"
    assert len(calls) == 2
    assert result.result["checks"][-1]["explanation"] == "No unfinished resume placeholders."
    assert result.result["checks"][-1]["evidence"][0]["excerpt"] == email
    assert result.result["checks"][0]["status"] == "pass"
    retries = [
        part.content
        for message in calls[-1]
        for part in message.parts
        if isinstance(part, RetryPromptPart)
    ]
    assert any("privacy" in text and "rewrite" in text.lower() for text in retries)
    assert all(marker not in text for text in retries)


def test_marker_check_uses_restoration_syntax_without_access_to_its_private_map(monkeypatch):
    from pii import PiiRestorationError, prepare_document, validate_privacy_markers

    monkeypatch.setattr("pii._detect_spans", lambda _text: [])
    original = "Contact jordan.taylor@example.test"
    protected, session = prepare_document(original, emails=["jordan.taylor@example.test"])
    value = {"nested": [protected]}
    validate_privacy_markers(value, protected_source={"text": protected})
    assert session.restore(value) == {"nested": [original]}
    for invalid in ("«pii:invented:PERSON:1»", "«pii:broken marker»", "«pii:unfinished"):
        with pytest.raises(PiiRestorationError):
            validate_privacy_markers({"nested": [invalid]}, protected_source=protected)
        with pytest.raises(PiiRestorationError):
            session.restore({"nested": [invalid]})


def test_missing_role_evidence_retry_uses_the_selection_contract(task_dependencies, monkeypatch):
    snapshot = Snapshot(
        resume_id=str(uuid4()),
        content_snapshot=[
            {
                "id": str(uuid4()),
                "section_type": "summary",
                "position": 0,
                "title": "Summary",
                "content": {"text": "Coordinated community events."},
            }
        ],
        job_snapshot=None,
        content_fingerprint="synthetic",
        job_fingerprint=None,
        rubric_version="ats-v1",
    )
    monkeypatch.setattr("pii._detect_spans", lambda _text: [])
    monkeypatch.setattr(
        "worker.ats_content_handler.screen_user_text",
        lambda *_args, **_kwargs: ScreenOutcome(allowed=True),
    )
    calls = []

    def respond(messages, info):
        calls.append(messages)
        retry_text = " ".join(
            part.content
            for message in messages
            for part in message.parts
            if isinstance(part, RetryPromptPart)
        )
        corrected = "evidence_ids" in retry_text and "e000000" in retry_text
        checks = [
            {
                "key": key,
                "status": "pass",
                "evidence_ids": ["e000001"],
                "explanation": "Clear.",
                "suggested_action": "",
                "severity": "info",
                "absence_reason": None,
            }
            for key in CHECK_KEYS
        ]
        checks[2].update(
            status="fail",
            evidence_ids=["e000000"] if corrected else [],
            explanation="No role or employer is identified.",
        )
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {"requirements": [], "checks": checks})]
        )

    monkeypatch.setattr(
        "agents.ats_content_agent.generative_model", lambda *_: FunctionModel(respond)
    )
    task = AiTaskMessage(
        ai_task_id=uuid4(),
        user_id=uuid4(),
        task_type="check_resume_content",
        input={
            "run_id": str(uuid4()),
            "resume_id": snapshot.resume_id,
            "content_fingerprint": snapshot.content_fingerprint,
            "job_fingerprint": None,
            "rubric_version": snapshot.rubric_version,
        },
    )
    result = handle_ats_content_task(
        task, replace(task_dependencies, read_ats_snapshot=lambda *_: snapshot)
    )
    assert result.status == "completed"
    assert len(calls) == 2
    assert result.result["checks"][2]["evidence"] == [
        {"section_id": snapshot.content_snapshot[0]["id"], "excerpt": "Summary"}
    ]
