"""Exercise pinned SDK request settings and billing receipts with mocked HTTP only.

Streamed requests are checked against the same receipt rules, including cancellation,
timeouts, a passed deadline and unpriced responses.
"""

import asyncio
import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from pydantic_ai import Agent, models
from pydantic_ai.models.function import FunctionModel

from interviews.models import InterviewModel, InterviewModels
from interviews.provider_calls import ProviderCalls
from tests.test_interview_executor import Client, claim

pytestmark = pytest.mark.real_guardrail


class AccountingClient(Client):
    def __init__(self):
        super().__init__()
        self.reports = []

    async def usage(self, request, entries, **kwargs):
        self.reports.append((entries, kwargs))
        await super().usage(request, entries, **kwargs)


def run_model(*, model="gpt-6-luna", input_tokens=100, writes=0):
    client, requests = AccountingClient(), []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        return httpx.Response(200, json={
            "id": "resp_synthetic", "object": "response", "created_at": 1,
            "status": "completed", "model": model,
            "output": [{"type": "message", "id": "msg_synthetic", "role": "assistant",
                        "status": "completed", "content": [{"type": "output_text", "text": "A response", "annotations": []}]}],
            "usage": {"input_tokens": input_tokens,
                      "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": writes,
                          "cache_write_tokens_details": {"ttl_30m_tokens": writes, "ttl_12h_tokens": 0}},
                      "output_tokens": 20, "output_tokens_details": {"reasoning_tokens": 0},
                      "total_tokens": input_tokens + 20}})

    async def execute():
        async with InterviewModels(openai_key="synthetic", typesafe_key="synthetic",
                                   openai_transport=httpx.MockTransport(respond)) as providers:
            with models.override_allow_model_requests(True):
                return await Agent().run("A synthetic interview response", model=providers.accounted(
                    client, claim(), "screening" if model == "gpt-5-nano" else "interviewer", model))

    return client, requests, execute


def test_luna_wire_request_disables_implicit_writes_without_changing_nano():
    for model in ("gpt-6-luna", "gpt-6.1-terra", "gpt-5-nano"):
        client, requests, execute = run_model(model=model)
        assert asyncio.run(execute()).output == "A response"
        assert len(requests) == 1
        assert requests[0]["service_tier"] == "default"
        if model != "gpt-5-nano":
            assert requests[0]["prompt_cache_options"] == {"mode": "explicit"}
            assert "prompt_cache_breakpoint" not in json.dumps(requests[0])
        else:
            assert "prompt_cache_options" not in requests[0]
        assert client.reports[-1][1]["incomplete"] is False


@pytest.mark.parametrize("model", ["gpt-6-luna", "gpt-6.1-terra"])
@pytest.mark.parametrize("input_tokens,writes", [(12_000, 7_000), (272_001, 0)])
def test_unpriceable_usage_remains_unknown_after_one_wire_dispatch(model, input_tokens, writes):
    client, requests, execute = run_model(model=model, input_tokens=input_tokens, writes=writes)
    with pytest.raises(ValueError, match="unknown_provider_usage"):
        asyncio.run(execute())
    assert len(requests) == 1
    entries, receipt = client.reports[-1]
    assert entries == [] and receipt["incomplete"] is True
    assert receipt["observation_id"] == client.calls[0][1]


# Streamed requests share the same rule: register first, bound by the deadline, always send one receipt,
# and only a complete, priced response becomes a known bill.

class FakeStreamResponse:
    def __init__(self):
        self.final = object()

    def get(self):
        return self.final


def fake_stream(opened):
    @asynccontextmanager
    async def open_stream():
        opened.append(True)
        yield FakeStreamResponse()
    return open_stream


def stream_once(request, body, finished=lambda response: [{"cost_microdollars": 1}]):
    client, opened = AccountingClient(), []

    async def execute():
        async with ProviderCalls(client).stream(request, "interviewer", "openai", "gpt-6-luna",
                                                fake_stream(opened), finished) as response:
            await body(response)

    return client, opened, execute


def only_receipt(client):
    starts = [call for call in client.calls if call[0] == "start"]
    assert len(starts) == 1 and len(client.reports) == 1
    entries, receipt = client.reports[0]
    assert receipt["observation_id"] == starts[0][1]
    return entries, receipt


def test_streamed_request_sends_one_incomplete_receipt_when_cancelled_mid_stream():
    async def body(response):
        raise asyncio.CancelledError

    client, opened, execute = stream_once(claim(), body, finished=lambda response: [])
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(execute())
    assert opened == [True]
    entries, receipt = only_receipt(client)
    assert entries == [] and receipt["incomplete"] is True


def test_streamed_request_times_out_at_the_deadline_and_sends_one_incomplete_receipt():
    request = claim().model_copy(update={"execution_deadline": datetime.now(UTC) + timedelta(seconds=0.05)})

    async def body(response):
        await asyncio.sleep(1)

    client, _, execute = stream_once(request, body, finished=lambda response: [])
    with pytest.raises(TimeoutError):
        asyncio.run(execute())
    entries, receipt = only_receipt(client)
    assert entries == [] and receipt["incomplete"] is True


def test_streamed_request_past_its_deadline_never_opens_the_stream():
    request = claim().model_copy(update={"execution_deadline": datetime.now(UTC) - timedelta(seconds=1)})

    async def body(response):
        raise AssertionError("The stream must not open")

    client, opened, execute = stream_once(request, body)
    with pytest.raises(TimeoutError):
        asyncio.run(execute())
    assert opened == []
    entries, receipt = only_receipt(client)
    assert entries == [] and receipt["incomplete"] is True


def test_streamed_request_keeps_a_received_bill_when_the_caller_fails_after_the_last_chunk():
    async def body(response):
        raise ValueError("invalid output")

    client, _, execute = stream_once(claim(), body)
    with pytest.raises(ValueError, match="invalid output"):
        asyncio.run(execute())
    entries, receipt = only_receipt(client)
    assert entries == [{"cost_microdollars": 1}] and receipt["incomplete"] is False


def test_unpriced_streamed_response_stays_unknown_after_its_receipt():
    async def stream_text(messages, info):
        yield "A response"

    client = AccountingClient()
    model = InterviewModel(FunctionModel(stream_function=stream_text), client, claim(), "interviewer", "openai", "gpt-6-luna")

    async def execute():
        with models.override_allow_model_requests(True):
            async with Agent(model).run_stream("A synthetic interview response") as result:
                await result.get_output()

    with pytest.raises(ValueError, match="unknown_provider_usage"):
        asyncio.run(execute())
    entries, receipt = only_receipt(client)
    assert entries == [] and receipt["incomplete"] is True


def streamed_response_events(model):
    usage = {"input_tokens": 100, "input_tokens_details": {"cached_tokens": 0}, "output_tokens": 20,
             "output_tokens_details": {"reasoning_tokens": 0}, "total_tokens": 120}
    base = {"id": "resp_synthetic", "object": "response", "created_at": 1, "model": model, "output": [],
            "parallel_tool_calls": True, "tool_choice": "auto", "tools": []}
    message = {"type": "message", "id": "msg_synthetic", "role": "assistant", "status": "completed",
               "content": [{"type": "output_text", "text": "A response", "annotations": []}]}
    events = [
        {"type": "response.created", "sequence_number": 0, "response": {**base, "status": "in_progress"}},
        {"type": "response.output_item.added", "sequence_number": 1, "output_index": 0,
         "item": {**message, "status": "in_progress", "content": []}},
        {"type": "response.content_part.added", "sequence_number": 2, "output_index": 0, "item_id": "msg_synthetic",
         "content_index": 0, "part": {"type": "output_text", "text": "", "annotations": []}},
        {"type": "response.output_text.delta", "sequence_number": 3, "output_index": 0, "item_id": "msg_synthetic",
         "content_index": 0, "delta": "A response", "logprobs": []},
        {"type": "response.output_item.done", "sequence_number": 4, "output_index": 0, "item": message},
        {"type": "response.completed", "sequence_number": 5,
         "response": {**base, "status": "completed", "output": [message], "usage": usage}},
    ]
    return "".join(f"event: {event['type']}\ndata: {json.dumps(event)}\n\n" for event in events)


@pytest.mark.parametrize("model", ["gpt-6-luna", "gpt-6.1-terra"])
def test_streamed_wire_request_keeps_pinned_settings_and_a_priced_receipt(model):
    client, requests = AccountingClient(), []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, headers={"content-type": "text/event-stream"},
                              content=streamed_response_events(model).encode())

    async def execute():
        async with InterviewModels(openai_key="synthetic", typesafe_key="synthetic",
                                   openai_transport=httpx.MockTransport(respond)) as providers:
            with models.override_allow_model_requests(True):
                async with Agent().run_stream("A synthetic interview response", model=providers.accounted(
                        client, claim(), "interviewer", model)) as result:
                    return await result.get_output()

    assert asyncio.run(execute()) == "A response"
    assert len(requests) == 1 and requests[0]["stream"] is True
    assert requests[0]["service_tier"] == "default"
    assert requests[0]["prompt_cache_options"] == {"mode": "explicit"}
    assert requests[0]["max_output_tokens"] == 1024
    entries, receipt = only_receipt(client)
    assert receipt["incomplete"] is False and entries[0]["cost_microdollars"] > 0
