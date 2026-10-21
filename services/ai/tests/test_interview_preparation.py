"""Exercise durable preparation through canonical claims and mocked model requests."""
import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from interviews.client import REAL_CONFIGURATION, Claim
from interviews.models import InterviewModel
from interviews.real import RealInterviewExecutor
from tests.test_interview_executor import Client

pytestmark = pytest.mark.real_guardrail


@pytest.fixture(autouse=True)
def synthetic_screening_credentials(monkeypatch):
    """Exercise real screening policy through the fake adapter without ambient keys."""
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic-key")


def preparation_claim():
    return Claim(operation_id="prepare", kind="preparation", execution_mode="real",
        execution_config=REAL_CONFIGURATION, attempt_id="attempt", claim_generation=1,
        lease_expires_at=datetime.now(UTC) + timedelta(seconds=30),
        execution_deadline=datetime.now(UTC) + timedelta(seconds=120),
        payload={"frozen_context": {"version": 1, "career_focus": "laboratory", "sources": [
            {"type": "profile", "id": "owner", "field": "summary", "text": "I calibrate laboratory equipment."}]}})


def test_preparation_claim_preserves_owned_frozen_sources():
    request = preparation_claim()
    assert request.payload.frozen_context["sources"][0]["text"] == "I calibrate laboratory equipment."

def prepared_output():
    return {"role": {"title": "Fictional laboratory technician", "responsibilities": ["Maintain equipment"],
            "requirements": ["Understand calibration"]}, "questions": [
        {"question_type": ["behavioral", "technical", "knowledge"][i % 3],
         "content": f"Laboratory equipment topic {i}?"} for i in range(9)]}


class PreparationClient(Client):
    async def accept_preparation(self, request, **payload):
        self.accepted.append(payload)


class Models:
    def __init__(self, *, blocked=False):
        self.requests = []
        self.blocked = blocked

    def accounted(self, rails, request, stage, name):
        async def respond(messages, info):
            self.requests.append((name, str(messages), info.model_settings))
            if name == "jev-1.13.0":
                output = {"prompt_injection": self.blocked, "harmful_request": False}
                details = {"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}}
            else:
                output, details = prepared_output(), {}
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)],
                usage=RequestUsage(input_tokens=100, output_tokens=500), provider_details=details)
        return InterviewModel(FunctionModel(respond, model_name=name), rails, request, stage,
            "typesafe" if name == "jev-1.13.0" else "openai", name)


def run(models, request=None):
    client = PreparationClient()
    with httpx.Client(transport=httpx.MockTransport(lambda request: pytest.fail("No storage request during preparation"))) as storage:
        executor = RealInterviewExecutor(client, audio=None, models=models, storage_client=storage,
            allowed_origins={"http://storage"}, allow_http=True)
        asyncio.run(executor.execute(request or preparation_claim()))
    return client


def test_preparation_screens_frozen_sources_and_accepts_complete_accounted_plan():
    models = Models()
    client = run(models)
    assert not client.failed
    assert client.accepted == [prepared_output()]
    assert [item[0] for item in models.requests] == ["jev-1.13.0", "gpt-6-luna"]
    assert "calibrate laboratory equipment" in models.requests[-1][1]
    assert "laboratory" in models.requests[-1][1]
    assert models.requests[-1][2]["max_tokens"] == 4096
    assert len([item for item in client.calls if item[0] == "start"]) == 2


def test_blocked_preparation_never_runs_reasoning_or_accepts_partial_questions():
    models = Models(blocked=True)
    client = run(models)
    assert client.failed == [("screening_blocked", False)]
    assert not client.accepted
    assert [item[0] for item in models.requests] == ["jev-1.13.0"]


def test_preparation_masks_known_contacts_and_does_not_reuse_library_as_role_claims():
    models = Models()
    request = preparation_claim()
    context = {**request.payload.frozen_context, "names": ["Morgan Sample"],
        "emails": ["morgan@example.test"], "phones": []}
    context["sources"] = [{"type": "profile", "id": "owner", "field": "summary",
        "text": "Morgan Sample calibrates laboratory equipment. Contact morgan@example.test."}]
    request = request.model_copy(update={"payload": request.payload.model_copy(update={"frozen_context": context})})
    client = run(models, request)
    assert not client.failed
    for _, messages, _ in models.requests:
        assert "Morgan Sample" not in messages
        assert "morgan@example.test" not in messages
    assert "NOT statements" in models.requests[-1][1]


def test_oversize_preparation_never_dispatches_a_provider():
    models = Models()
    request = preparation_claim()
    request = request.model_copy(update={"payload": request.payload.model_copy(
        update={"frozen_context": {"sources": [{"text": "x" * 120_001}]}})})
    client = run(models, request)
    assert client.failed == [("context_limit", False)]
    assert not models.requests
    assert not client.accepted
