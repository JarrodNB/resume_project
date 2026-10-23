"""Verify the real interviewer contract with local provider messages, never paid models."""

import asyncio

import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart, ToolReturnPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from agents.spoken_interviewer_agent import make_interviewer

pytestmark = pytest.mark.real_guardrail


@pytest.mark.parametrize("acknowledgement", [None, "You repaired the appointment calendar."])
def test_real_interviewer_uses_actual_prompt_and_pairs_advance_tool(acknowledgement):
    observed = []

    async def respond(messages, info):
        observed.append(str(messages))
        if not any(isinstance(part, ToolReturnPart) and part.tool_name == "advance_to_next_question"
                   for message in messages for part in message.parts):
            return ModelResponse(parts=[ToolCallPart("advance_to_next_question", {})],
                                 usage=RequestUsage(input_tokens=20, output_tokens=5))
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
                             {"decision": "advance", "acknowledgement": acknowledgement, "reply": None})],
                             usage=RequestUsage(input_tokens=25, output_tokens=5))

    async def guard(ctx, prompt):
        return True

    agent = make_interviewer(guard)
    result = asyncio.run(agent.run("Actual answer: I repaired the appointment calendar",
                                   model=FunctionModel(respond)))
    assert result.output.decision == "advance"
    assert result.output.acknowledgement == acknowledgement
    assert "appointment calendar" in observed[0]
    assert "Rails" in observed[0]
    assert len(observed) == 2


def test_each_validation_retry_has_a_distinct_durable_observation():
    from interviews.models import InterviewModel
    from tests.test_interview_executor import Client, claim

    client = Client()
    dispatched = []

    async def respond(messages, info):
        dispatched.append(len([call for call in client.calls if call[0] == "start"]))
        output = {"decision": "continue", "acknowledgement": "You changed the scheduling process.", "reply": "" if len(dispatched) == 1 else "What changed for users?"}
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)],
                             model_name="gpt-6-luna", usage=RequestUsage(input_tokens=100, output_tokens=20))

    async def guard(ctx, prompt):
        return True

    result = asyncio.run(make_interviewer(guard).run("The actual answer", model=InterviewModel(
        FunctionModel(respond, model_name="gpt-6-luna"), client, claim(), "interviewer", "openai", "gpt-6-luna")))
    assert result.output.reply == "What changed for users?"
    assert dispatched == [1, 2]
    charged = [call for call in client.calls if call[0] == "usage"]
    assert len(charged) == 2 and all(call[2][0]["cost_microdollars"] == 20 for call in charged)


def test_unexpected_model_usage_stops_before_accepting_output():
    from interviews.models import InterviewModel
    from tests.test_interview_executor import Client, claim

    client = Client()

    async def respond(messages, info):
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
                             {"decision": "continue", "acknowledgement": "You changed the scheduling process.", "reply": "What changed?"})],
                             model_name="unexpected-model", usage=RequestUsage(input_tokens=100, output_tokens=20))

    async def guard(ctx, prompt):
        return True

    with pytest.raises(ValueError, match="unknown_provider_usage"):
        asyncio.run(make_interviewer(guard).run("The answer", model=InterviewModel(
            FunctionModel(respond, model_name="unexpected-model"), client, claim(), "interviewer", "openai", "gpt-6-luna")))
    assert client.calls[-1][2] == []


def test_synthetic_eval_fixture_contracts_offline():
    from evals.run_spoken_interviewer_evals import run_spoken_interviewer_evals

    report = run_spoken_interviewer_evals()
    assert len(report.cases) == 3 and not report.failures
    assert all(all(result.value for result in case.assertions.values()) for case in report.cases)


@pytest.mark.parametrize("name,stage", [("gpt-6-luna", "interviewer"), ("jev-1.13.0", "screening")])
def test_provider_sdk_errors_make_exactly_one_http_dispatch(name, stage):
    import httpx
    import httpx2
    from pydantic_ai import models
    from pydantic_ai.exceptions import ModelHTTPError

    from agents.user_text_screen_agent import screen_user_message_async, user_text_screen_agent
    from interviews.models import InterviewModels
    from tests.test_interview_executor import Client, claim

    seen = []

    def openai_error(request):
        seen.append(request.url.host)
        return httpx.Response(500, json={"error": {"message": "synthetic unavailable"}})

    def typesafe_error(request):
        seen.append(request.url.host)
        return httpx2.Response(500, json={"error": "synthetic unavailable"})

    async def execute():
        async with InterviewModels(openai_key="synthetic", typesafe_key="synthetic",
                                   openai_transport=httpx.MockTransport(openai_error),
                                   typesafe_transport=httpx2.MockTransport(typesafe_error)) as providers:
            client = Client()
            model = providers.accounted(client, claim(), stage, name)
            async def guard(ctx, prompt):
                return True
            with models.override_allow_model_requests(True), pytest.raises(ModelHTTPError):
                if stage == "screening":
                    with user_text_screen_agent.override(model=model):
                        await screen_user_message_async("A synthetic answer", "typesafe:jev-1.13.0", 3)
                else:
                    await make_interviewer(guard).run("A synthetic answer", model=model)
            assert client.calls[-1][0] == "usage" and client.calls[-1][2] == []

    asyncio.run(execute())
    assert len(seen) == 1


def test_successful_typesafe_screen_has_one_wire_request_per_observation():
    import json

    import httpx2
    from pydantic_ai import models

    from agents.user_text_screen_agent import screen_user_message_async, user_text_screen_agent
    from interviews.models import InterviewModels
    from tests.test_interview_executor import Client, claim

    seen = []
    client = Client()

    def respond(request):
        payload = json.loads(request.content)
        seen.append(payload)
        assert len(payload["questions"]) == 2
        assert all(question["type"] == "noul" for question in payload["questions"].values())
        assert [call[0] for call in client.calls] == ["start"]
        return httpx2.Response(200, json={"model": "jev-1.13.0",
            "usage": {"input_tokens": 100, "output_tokens": 0},
            "answers": {key: {"type": "noul", "noul": 0.01} for key in payload["questions"]}})

    async def execute():
        async with InterviewModels(openai_key="synthetic", typesafe_key="synthetic",
                                   typesafe_transport=httpx2.MockTransport(respond)) as providers:
            model = providers.accounted(client, claim(), "screening", "jev-1.13.0")
            with models.override_allow_model_requests(True), user_text_screen_agent.override(model=model):
                result = await screen_user_message_async("I improved a scheduling process.", "typesafe:jev-1.13.0", 3)
            assert not result.screen.prompt_injection and not result.screen.harmful_request

    asyncio.run(execute())
    assert len(seen) == 1
    assert [call[0] for call in client.calls] == ["start", "usage"]
    assert client.calls[-1][2][0]["cost_microdollars"] == 5


@pytest.mark.parametrize("acknowledgement", ["", " ", "x" * 281])
def test_present_acknowledgement_is_nonblank_and_bounded(acknowledgement):
    from pydantic import ValidationError

    from schemas.spoken_interview import SpokenInterviewReply

    with pytest.raises(ValidationError):
        SpokenInterviewReply.model_validate({"decision": "continue", "reply": "What changed?",
                                            "acknowledgement": acknowledgement})


def test_acknowledgement_and_follow_up_share_the_speech_text_limit():
    from pydantic import ValidationError

    from schemas.spoken_interview import SpokenInterviewReply

    with pytest.raises(ValidationError):
        SpokenInterviewReply(acknowledgement="You changed the booking process.", decision="continue", reply="x" * 4000)


@pytest.mark.parametrize("decision,reply", [("continue", "x" * 4000), ("advance", None)], ids=["follow-up-at-limit", "advance"])
@pytest.mark.parametrize("optional", [{}, {"acknowledgement": None}])
def test_reply_can_omit_acknowledgement(decision, reply, optional):
    from schemas.spoken_interview import SpokenInterviewReply

    result = SpokenInterviewReply.model_validate({"decision": decision, "reply": reply, **optional})
    assert result.acknowledgement is None
    assert result.reply == reply
