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

def test_handler_masks_natural_values_without_corrupting_json(task_dependencies, monkeypatch):
    import json
    from dataclasses import replace

    from pydantic_ai import capture_run_messages
    from pydantic_ai.models.test import TestModel

    from screening.screen_user_text import ScreenOutcome
    from worker.contact_mask import mask_outbound

    detected = []
    def detect(text):
        detected.append(text)
        if '"content_snapshot"' in text:
            # Simulate an NLP name span extending across the serialized value's closing quote.
            start = text.index('Ada Lovelace')
            return [(start, len(text), "PERSON")]
        return [(text.index(name), text.index(name) + len(name), "PERSON")
                for name in ("Ada Lovelace", "Morgan Chen", "content") if name in text]
    monkeypatch.setattr("pii._detect_spans", detect)
    text = 'Ada Lovelace wrote "content" with {braces}, a backslash \\ and\nMorgan Chen reviewed it.'
    snapshot = Snapshot(resume_id=str(uuid4()),
        content_snapshot=[{"id": "content", "section_type": "summary", "position": 0,
                           "title": "Summary", "content": {"text": text}},
                          {"id": "second", "section_type": "custom", "position": 1,
                           "title": "Review", "content": {"text": "Morgan Chen checked Ada Lovelace"}}],
        job_snapshot={"requirements": [{"id": "content", "text": "Collaborate with Morgan Chen", "required": True}]},
        content_fingerprint="content", job_fingerprint="content", rubric_version="content")
    screened = []
    def screen(source, **kwargs):
        parsed = json.loads(source)
        repeated = mask_outbound(source)
        assert json.loads(repeated) == parsed
        assert parsed["content_fingerprint"] == "content"
        assert parsed["rubric_version"] == "content"
        assert parsed["content_snapshot"][0]["id"] == "content"
        assert parsed["job_snapshot"]["requirements"][0]["id"] == "content"
        assert "Ada Lovelace" not in source and "Morgan Chen" not in source
        screened.append(source)
        return ScreenOutcome(allowed=True)
    monkeypatch.setattr("worker.ats_content_handler.screen_user_text", screen)
    def model(*args):
        parsed = json.loads(screened[-1])
        excerpt = parsed["content_snapshot"][0]["content"]["text"]
        evidence = [{"section_id": "content", "excerpt": excerpt}]
        output = {"requirements": [{"requirement_id": "content", "status": "covered",
            "evidence": evidence, "explanation": "Supported", "suggested_action": ""}],
            "checks": [{"key": key, "status": "pass", "evidence": evidence,
                        "explanation": "Supported", "suggested_action": ""} for key in CHECK_KEYS]}
        return TestModel(custom_output_args=output)
    monkeypatch.setattr("agents.ats_content_agent.generative_model", model)
    task = AiTaskMessage(ai_task_id=uuid4(), user_id=uuid4(), task_type="check_resume_content",
        input={"run_id": str(uuid4()), "resume_id": snapshot.resume_id,
               "content_fingerprint": "content", "job_fingerprint": "content", "rubric_version": "content"})
    dependencies = replace(task_dependencies, read_ats_snapshot=lambda *_: snapshot)
    with capture_run_messages() as messages:
        result = handle_ats_content_task(task, dependencies)
    assert result.status == "completed"
    assert result.result["requirements"][0]["evidence"][0]["excerpt"] == text
    assert result.result["content_fingerprint"] == "content"
    provider_prompts = [part.content for message in messages for part in message.parts
                        if getattr(part, "part_kind", "") == "user-prompt"]
    assert screened[0] in provider_prompts
    assert all("Ada Lovelace" not in prompt and "Morgan Chen" not in prompt for prompt in provider_prompts)
    assert all('"content_snapshot"' not in text for text in detected)
    assert "Summary" in detected and "Review" in detected
    assert snapshot.content_snapshot[0]["content"]["text"] == text

def test_snapshot_preparation_keeps_field_discoveries_and_profile_in_one_session(monkeypatch):
    from worker.ats_content_privacy import prepare_ats_snapshot
    from worker.contact_mask import import_privacy_scope
    from worker.known_contact import KnownContact

    seen = []
    def detect(text):
        seen.append(text)
        # A flattened detector would swallow a cross-field name that neither leaf contains.
        if "Ada Lovelace\nMorgan Chen" in text:
            start = text.index("Ada Lovelace")
            return [(start, start + len("Ada Lovelace\nMorgan Chen"), "PERSON")]
        if text in ("Ada Lovelace", "Morgan Chen"):
            return [(0, len(text), "PERSON")]
        return []
    monkeypatch.setattr("pii._detect_spans", detect)
    snapshot = Snapshot(resume_id=str(uuid4()), content_snapshot=[
        {"id": "s1", "section_type": "summary", "title": "Ada Lovelace",
         "content": {"text": "Morgan Chen", "other": "Morgan Chen and Casey Nguyen reviewed Ada Lovelace"}}
    ], job_snapshot=None, content_fingerprint="identity", job_fingerprint=None, rubric_version="v1")
    contact = KnownContact.from_values(names=["Casey Nguyen"])
    with import_privacy_scope(contact) as privacy:
        protected = prepare_ats_snapshot(snapshot, privacy)
        source = protected.model_dump_json()
        for name in ("Ada Lovelace", "Morgan Chen", "Casey Nguyen"):
            assert name not in source
            assert name not in privacy.mask("Contact " + name)
        assert privacy.restore(protected) == snapshot
    assert "Ada Lovelace" in seen and "Morgan Chen" in seen
    assert not any("Ada Lovelace\nMorgan Chen" in text for text in seen)
