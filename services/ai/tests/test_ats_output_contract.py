"""Exercise the ATS provider tool contract and grounded validation retry feedback offline."""

import json
from dataclasses import replace
from uuid import uuid4

import httpx
import pytest
from pydantic_ai import models
from pydantic_ai.models.openai import OpenAIChatModel, OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider

from schemas.ats_content import CHECK_KEYS, Snapshot
from screening.screen_user_text import ScreenOutcome
from worker.ats_content_handler import handle_ats_content_task
from worker.queue_messages import AiTaskMessage


@pytest.mark.parametrize("responses", [False, True])
@pytest.mark.parametrize("section_id", ["7bfc2d1a-59c8-4e62-9d30-e84a6130519c", "0", "empty"])
def test_provider_requires_complete_structured_assessments(
    task_dependencies, monkeypatch, responses, section_id
):
    section = {
        "section_type": "skills",
        "title": "Skills",
        "position": 0,
        "content": {"text": "Python"},
    }
    if section_id != "0":
        section["id"] = section_id
    snapshot = Snapshot(
        resume_id=str(uuid4()),
        content_snapshot=[
            section,
            {
                "id": "05c02311-6ca4-49b9-a6fb-58a15d31d6fe",
                "section_type": "summary",
                "title": "Summary",
                "position": 1,
                "content": {"text": "SQL reporting"},
            },
        ],
        job_snapshot=None,
        content_fingerprint="content",
        job_fingerprint=None,
        rubric_version="1",
    )
    if section_id == "empty":
        snapshot.content_snapshot = []
    output = {
        "requirements": [],
        "checks": [
            {
                "key": key,
                "status": (
                    "fail" if key in ("contact_usability", "section_labels") else "unavailable"
                )
                if section_id == "empty"
                else "pass",
                "evidence_ids": [] if section_id == "empty" else ["e000001"],
                "explanation": "Clear",
                "suggested_action": "",
                "severity": "info",
                "absence_reason": "No saved sections." if section_id == "empty" else None,
            }
            for key in CHECK_KEYS
        ],
    }
    seen = []

    def reply(request):
        body = json.loads(request.content)
        seen.append(body)
        tool = body["tools"][0] if responses else body["tools"][0]["function"]
        if responses:
            return httpx.Response(
                200,
                json={
                    "id": "resp-synthetic",
                    "object": "response",
                    "created_at": 1,
                    "status": "completed",
                    "model": "gpt-5-mini",
                    "output": [
                        {
                            "type": "function_call",
                            "id": "fc-1",
                            "call_id": "call-1",
                            "name": tool["name"],
                            "arguments": json.dumps(output),
                        }
                    ],
                    "usage": {
                        "input_tokens": 10,
                        "output_tokens": 10,
                        "total_tokens": 20,
                        "input_tokens_details": {"cached_tokens": 0},
                        "output_tokens_details": {"reasoning_tokens": 0},
                    },
                },
            )
        return httpx.Response(
            200,
            json={
                "id": "synthetic",
                "object": "chat.completion",
                "created": 1,
                "model": "gpt-5-mini",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call-1",
                                    "type": "function",
                                    "function": {
                                        "name": tool["name"],
                                        "arguments": json.dumps(output),
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 10, "total_tokens": 20},
            },
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(reply))
    model = (OpenAIResponsesModel if responses else OpenAIChatModel)(
        "gpt-5-mini", provider=OpenAIProvider(api_key="offline", http_client=client)
    )
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    monkeypatch.setattr("agents.ats_content_agent.generative_model", lambda *_: model)
    monkeypatch.setattr(
        "worker.ats_content_handler.screen_user_text",
        lambda *_args, **_kwargs: ScreenOutcome(allowed=True),
    )
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
    result = handle_ats_content_task(
        task, replace(task_dependencies, read_ats_snapshot=lambda *_: snapshot)
    )
    assert result.status == "completed"
    tool = seen[0]["tools"][0] if responses else seen[0]["tools"][0]["function"]
    assert tool.get("strict") is True
    definitions = tool["parameters"][chr(36) + "defs"]
    for name in ("RequirementSelection", "CheckSelection"):
        schema = definitions[name]
        assert set(schema["required"]) == set(schema["properties"])
        assert schema["additionalProperties"] is False
        assert "evidence" not in schema["properties"]
        refs = schema["properties"]["evidence_ids"]
        if section_id == "empty":
            assert refs.get("maxItems") == 0
            assert refs["items"].get("enum") != []
        else:
            assert refs["items"].get("enum") == ["e000000", "e000001", "e000002", "e000003"]
    assert "evidence_catalog" in json.dumps(seen[0])
    assert "field_path" in json.dumps(seen[0])
    if section_id != "empty":
        assert result.result["checks"][-1]["evidence"] == [
            {"section_id": section_id, "excerpt": "Python"}
        ]


def test_retry_feedback_identifies_omitted_requirements_without_relaxing_coverage():
    from schemas.ats_content import Assessment, validate_assessment

    output = Assessment(
        requirements=[],
        checks=[
            {
                "key": key,
                "status": "pass",
                "evidence": [{"section_id": "s1", "excerpt": "Python"}],
                "explanation": "Supported",
                "suggested_action": "",
            }
            for key in CHECK_KEYS
        ],
    )
    with pytest.raises(ValueError, match="r1.*r2"):
        validate_assessment(
            output, [{"id": "s1", "content": {"text": "Python"}}], [{"id": "r1"}, {"id": "r2"}]
        )


def test_retry_feedback_names_the_applicable_check_missing_evidence():
    from schemas.ats_content import Assessment, validate_assessment

    output = Assessment(
        requirements=[],
        checks=[
            {
                "key": key,
                "status": "pass",
                "evidence": [] if key == "dates" else [{"section_id": "s1", "excerpt": "Python"}],
                "explanation": "Supported",
                "suggested_action": "",
            }
            for key in CHECK_KEYS
        ],
    )
    with pytest.raises(ValueError, match="dates"):
        validate_assessment(output, [{"id": "s1", "content": {"text": "Python"}}], [])


def test_paid_runner_rejects_false_coverage_assertions(monkeypatch):
    from types import SimpleNamespace

    import evals.run_ats_content_evals as runner
    from worker.settings import WorkerSettings

    report = SimpleNamespace(
        failures=[],
        report_evaluator_failures=[],
        cases=[
            SimpleNamespace(
                evaluator_failures=[],
                assertions={"RequirementCoverage": SimpleNamespace(value=False)},
            )
        ],
    )
    monkeypatch.setattr(runner, "load_settings", WorkerSettings)
    monkeypatch.setattr(runner, "evaluate_dataset", lambda *_args, **_kwargs: report)
    with pytest.raises(RuntimeError, match="assertion"):
        runner.run_ats_content_evals()


def test_runtime_still_rejects_section_type_instead_of_saved_uuid():
    from schemas.ats_content import Assessment, validate_assessment

    output = Assessment(
        requirements=[],
        checks=[
            {
                "key": key,
                "status": "pass",
                "evidence": [{"section_id": "skills", "excerpt": "Python"}],
                "explanation": "Supported",
                "suggested_action": "",
            }
            for key in CHECK_KEYS
        ],
    )
    with pytest.raises(ValueError, match="Invalid resume evidence"):
        validate_assessment(
            output,
            [
                {
                    "id": "7bfc2d1a-59c8-4e62-9d30-e84a6130519c",
                    "section_type": "skills",
                    "position": 0,
                    "title": "Skills",
                    "content": {"text": "Python"},
                }
            ],
            [],
        )
