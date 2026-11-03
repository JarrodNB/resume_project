"""Price real-shaped Luna and Terra SDK receipts through queued accounting with mocked HTTP only."""
import asyncio
import json

import httpx
import pytest
from pydantic_ai import Agent, models
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider

from llm.usage import accounted_model, collect_task_usage


@pytest.mark.parametrize("model_name,cost", [("gpt-6-luna", 1_700), ("gpt-6.1-terra", 17_000)])
def test_queued_model_fixes_cache_lifetime_and_records_writes_and_response_identity(model_name, cost):
    bodies = []

    def respond(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={
            "id": "resp_synthetic", "object": "response", "created_at": 1,
            "status": "completed", "model": model_name,
            "output": [{"type": "message", "id": "msg_synthetic", "role": "assistant",
                        "status": "completed", "content": [{"type": "output_text", "text": "A response", "annotations": []}]}],
            "usage": {"input_tokens": 10_000,
                      "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 8_000,
                          "cache_write_tokens_details": {"ttl_30m_tokens": 8_000, "ttl_12h_tokens": 0}},
                      "output_tokens": 1_000, "output_tokens_details": {"reasoning_tokens": 0},
                      "total_tokens": 11_000}})

    async def execute():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            model = OpenAIResponsesModel(model_name, provider=OpenAIProvider(api_key="synthetic", http_client=http))
            with collect_task_usage() as usage, models.override_allow_model_requests(True):
                await Agent(accounted_model(model)).run("A synthetic career detail")
                return usage

    usage = asyncio.run(execute())
    assert bodies[0]["prompt_cache_options"] == {"mode": "implicit", "ttl": "30m"}
    assert bodies[0]["service_tier"] == "default"
    assert not usage.incomplete
    assert usage.entries[0].cost_microdollars == cost
    assert usage.entries[0].cache_write_tokens == 8_000
    assert usage.entries[0].provider_response_id == "resp_synthetic"
