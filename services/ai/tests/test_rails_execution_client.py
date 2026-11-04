"""Check the shared lease and accounting transport through both domain clients."""
import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from chat.client import RailsChatClient
from interviews.client import RailsInterviewClient


@pytest.mark.parametrize('client_class, namespace', [(RailsChatClient, 'chat'), (RailsInterviewClient, 'interviews')])
def test_lease_retry_keeps_identity_credentials_and_namespace(client_class, namespace):
    requests = []

    def respond(request):
        requests.append(request)
        if len(requests) == 1:
            raise httpx.ReadTimeout('private transport detail')
        return httpx.Response(200, json={})

    async def check():
        claim = SimpleNamespace(operation_id='op', identity=lambda: {'attempt_id': 'attempt', 'claim_generation': 2})
        async with client_class('http://rails.test', 'secret', transport=httpx.MockTransport(respond)) as client:
            await client.heartbeat(claim, checkpoint='running')

    asyncio.run(check())
    assert len(requests) == 2
    assert requests[0].content == requests[1].content
    assert str(requests[0].url) == f'http://rails.test/internal/{namespace}/operations/op/heartbeat'
    assert requests[0].headers['Authorization'] == 'Bearer secret'
    assert json.loads(requests[0].content) == {'attempt_id': 'attempt', 'claim_generation': 2, 'checkpoint': 'running'}


@pytest.mark.parametrize('client_class', [RailsChatClient, RailsInterviewClient])
def test_usage_preserves_boolean_duplicate_receipt(client_class):
    async def check():
        claim = SimpleNamespace(operation_id='op', identity=lambda: {'attempt_id': 'attempt', 'claim_generation': 2})
        async with client_class('http://rails.test', 'secret', transport=httpx.MockTransport(lambda _: httpx.Response(200, json=False))) as client:
            assert await client.usage(claim, [], incomplete=True) is False

    asyncio.run(check())
