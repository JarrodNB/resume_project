"""Exercise durable preparation through canonical claims and mocked model requests."""
import asyncio
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic import ValidationError
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
        payload={"preparation_context": {"version": 1, "career_focus": "laboratory", "sources": [
            {"type": "profile", "id": "owner", "field": "summary", "text": "I calibrate laboratory equipment."}]}})


def test_preparation_claim_preserves_owned_frozen_sources():
    request = preparation_claim()
    assert request.payload.preparation_context["sources"][0]["text"] == "I calibrate laboratory equipment."


def test_preparation_applies_saved_style_without_changing_format():
    raw = preparation_claim().model_dump()
    raw["payload"]["setup"] = {"question_count": 9, "difficulty": "stretch", "interviewer": "priya",
        "focus_areas": ["leadership", "impact_metrics"]}
    models = Models()
    client = run(models, Claim.model_validate(raw))
    assert client.accepted == [prepared_output()]
    prompt = models.requests[-1][1]
    assert "harder scenarios" in prompt
    assert "Priya" in prompt
    assert "leadership, impact & metrics" in prompt
    assert "never invent achievements" in prompt


@pytest.mark.parametrize("extra", [{"difficulty": "unknown"}, {"interviewer": "unknown"},
    {"focus_areas": ["unknown"]}, {"focus_areas": ["leadership", "leadership"]}, {"focus_areas": None}])
def test_claim_rejects_invalid_style_configuration(extra):
    raw = preparation_claim().model_dump()
    raw["payload"]["setup"] = {"question_count": 8, **extra}
    with pytest.raises(ValidationError):
        Claim.model_validate(raw)

def prepared_output(count=9, question_format="mixed"):
    cycle = {"mixed": ["behavioral", "technical", "knowledge"], "behavioral": ["behavioral"],
        "technical": ["technical", "knowledge"], "screening": ["screening"]}[question_format]
    return {"role": {"title": "Fictional laboratory technician", "responsibilities": ["Maintain equipment"],
            "requirements": ["Understand calibration"]}, "questions": [
        {"question_type": cycle[i % len(cycle)],
         "content": f"Laboratory equipment topic {i}?"} for i in range(count)]}


class PreparationClient(Client):
    async def accept_preparation(self, request, **payload):
        self.accepted.append(payload)


class Models:
    def __init__(self, *, blocked=False, count=9, question_format="mixed", wrong_order=False):
        self.requests = []
        self.blocked = blocked
        self.count = count
        self.question_format = question_format
        self.wrong_order = wrong_order

    def accounted(self, rails, request, stage, name):
        async def respond(messages, info):
            self.requests.append((name, str(messages), info.model_settings))
            if name == "jev-1.13.0":
                output = {"prompt_injection": self.blocked, "harmful_request": False}
                details = {"confidence": {"prompt_injection": 1.0, "harmful_request": 1.0}}
            else:
                output, details = prepared_output(self.count, self.question_format), {}
                if self.wrong_order:
                    questions = output["questions"]
                    questions[0]["question_type"], questions[1]["question_type"] = (
                        questions[1]["question_type"], questions[0]["question_type"])
            return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)],
                usage=RequestUsage(input_tokens=100, output_tokens=500), provider_details=details)
        return InterviewModel(FunctionModel(respond, model_name=name), rails, request, stage,
            "typesafe" if name == "jev-1.13.0" else "openai", name)


def run(models, request=None, client=None):
    client = client or PreparationClient()
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
    assert [item[0] for item in models.requests] == ["gpt-6-luna"]
    assert "calibrate laboratory equipment" in models.requests[-1][1]
    assert "laboratory" in models.requests[-1][1]
    assert models.requests[-1][2]["max_tokens"] == 4096
    assert len([item for item in client.calls if item[0] == "start"]) == 1


def test_preparation_masks_known_contacts_and_does_not_reuse_library_as_role_claims():
    models = Models()
    request = preparation_claim()
    context = {**request.payload.preparation_context, "avoided_questions": ["How did Morgan Sample contact morgan@example.test?"], "names": ["Morgan Sample"],
        "emails": ["morgan@example.test"], "phones": []}
    context["sources"] = [{"type": "profile", "id": "owner", "field": "summary",
        "text": "Morgan Sample calibrates laboratory equipment. Contact morgan@example.test."}]
    request = request.model_copy(update={"payload": request.payload.model_copy(update={"preparation_context": context})})
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
        update={"preparation_context": {"sources": [{"text": "x" * 120_001}]}})})
    client = run(models, request)
    assert client.failed == [("context_limit", False)]
    assert not models.requests
    assert not client.accepted


@pytest.mark.parametrize("count", [5, 8, 12])
def test_preparation_uses_saved_question_count_and_interleaved_policy(count):
    raw = preparation_claim().model_dump(mode="json")
    raw["payload"]["setup"] = {"question_count": count}
    models = Models(count=count)
    client = run(models, Claim.model_validate(raw))
    assert not client.failed
    assert client.accepted == [prepared_output(count)]
    assert f"exactly {count}" in models.requests[-1][1]


def test_preparation_does_not_accept_another_allowed_length_than_the_saved_choice():
    raw = preparation_claim().model_dump(mode="json")
    raw["payload"]["setup"] = {"question_count": 5}
    client = run(Models(count=8), Claim.model_validate(raw))
    assert client.failed
    assert not client.accepted


@pytest.mark.parametrize("count", [5, 8, 12])
@pytest.mark.parametrize("question_format", ["mixed", "behavioral", "technical", "screening"])
def test_preparation_uses_saved_format_in_generation_and_validation(count, question_format):
    raw = preparation_claim().model_dump(mode="json")
    raw["payload"]["setup"] = {"question_count": count, "question_format": question_format}
    models = Models(count=count, question_format=question_format)
    client = run(models, Claim.model_validate(raw))
    assert not client.failed
    assert client.accepted == [prepared_output(count, question_format)]
    assert f"format is {question_format}" in models.requests[-1][1]


@pytest.mark.parametrize("question_format", ["mixed", "behavioral", "technical", "screening"])
def test_preparation_rejects_output_for_another_format(question_format):
    raw = preparation_claim().model_dump(mode="json")
    raw["payload"]["setup"] = {"question_count": 5, "question_format": question_format}
    other = "behavioral" if question_format == "screening" else "screening"
    client = run(Models(count=5, question_format=other), Claim.model_validate(raw))
    assert client.failed
    assert not client.accepted


@pytest.mark.parametrize("question_format", ["mixed", "technical"])
def test_preparation_rejects_permitted_categories_in_wrong_order(question_format):
    raw = preparation_claim().model_dump(mode="json")
    raw["payload"]["setup"] = {"question_count": 5, "question_format": question_format}
    client = run(Models(count=5, question_format=question_format, wrong_order=True), Claim.model_validate(raw))
    assert client.failed
    assert not client.accepted


@pytest.mark.parametrize("setup", [{}, {"question_count": 6}, {"question_count": "8"}, {"question_count": 8, "extra": True},
    {"question_count": 5, "question_format": "unknown"}, {"question_count": 5, "question_format": None}, None])
def test_malformed_explicit_saved_setup_is_rejected_instead_of_becoming_legacy(setup):
    raw = preparation_claim().model_dump(mode="json")
    raw["payload"]["setup"] = setup
    with pytest.raises(ValidationError):
        Claim.model_validate(raw)


def test_preparation_uses_generated_avoidance_data_without_rescreening_it():
    models = Models()
    request = preparation_claim()
    request.payload.preparation_context["avoided_questions"] = ["Describe an old calibration challenge?"]
    client = run(models, request)
    assert not client.failed
    assert "Describe an old calibration challenge?" in models.requests[-1][1]
    assert "Avoided questions" in models.requests[-1][1]


@pytest.mark.parametrize("excluded", [["x" * 2001], ["question"] * 51, "invalid", [""]])
def test_invalid_saved_avoidance_never_calls_providers(excluded):
    models = Models()
    request = preparation_claim()
    request.payload.preparation_context["avoided_questions"] = excluded
    client = run(models, request)
    assert client.failed == [("context_limit", False)]
    assert not models.requests


def test_saved_avoidance_overflow_fails_without_omitting_questions():
    models = Models()
    request = preparation_claim()
    request.payload.preparation_context["avoided_questions"] = ["q" * 2000] * 50
    request.payload.preparation_context["sources"] = [{"text": "x" * 30000}]
    client = run(models, request)
    assert client.failed == [("context_limit", False)]
    assert not models.requests
