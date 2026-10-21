"""Exercise pinned SDK request settings and billing receipts with mocked HTTP only."""

import asyncio
import json

import httpx
import pytest
from pydantic_ai import Agent, models

from interviews.models import InterviewModels
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
                    client, claim(), "interviewer" if model == "gpt-6-luna" else "screening", model))

    return client, requests, execute


def test_luna_wire_request_disables_implicit_writes_without_changing_nano():
    for model in ("gpt-6-luna", "gpt-5-nano"):
        client, requests, execute = run_model(model=model)
        assert asyncio.run(execute()).output == "A response"
        assert len(requests) == 1
        assert requests[0]["service_tier"] == "default"
        if model == "gpt-6-luna":
            assert requests[0]["prompt_cache_options"] == {"mode": "explicit"}
            assert "prompt_cache_breakpoint" not in json.dumps(requests[0])
        else:
            assert "prompt_cache_options" not in requests[0]
        assert client.reports[-1][1]["incomplete"] is False


@pytest.mark.parametrize("input_tokens,writes", [(12_000, 7_000), (272_001, 0)])
def test_unpriceable_luna_usage_remains_unknown_after_one_wire_dispatch(input_tokens, writes):
    client, requests, execute = run_model(input_tokens=input_tokens, writes=writes)
    with pytest.raises(ValueError, match="unknown_provider_usage"):
        asyncio.run(execute())
    assert len(requests) == 1
    entries, receipt = client.reports[-1]
    assert entries == [] and receipt["incomplete"] is True
    assert receipt["observation_id"] == client.calls[0][1]
