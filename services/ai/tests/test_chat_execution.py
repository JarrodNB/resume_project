"""Exercise chat through its guarded streaming execution adapter without providers."""
import asyncio
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from pydantic_ai.models.function import FunctionModel

from chat.client import ChatClaim
from chat.execution import ChatExecutionAdapter, ChatRejected
from chat.models import ChatModel


@pytest.fixture(autouse=True)
def fast_detector(monkeypatch):
    monkeypatch.setattr("pii._detect_spans", lambda text: [])


@pytest.fixture
def anyio_backend():
    return "asyncio"


class Owner:
    def __init__(self):
        self.accepted = []
        self.failed = []
        self.starts = []
        self.receipts = []

    async def start_provider(self, claim, observation_id, stage, provider, model):
        self.starts.append((observation_id, stage, provider, model))
        return {'observation_id': observation_id}

    async def usage(self, claim, usage, *, incomplete=False, observation_id=None):
        self.receipts.append((observation_id, usage, incomplete))
        return True

    async def accept(self, claim, **values):
        self.accepted.append(values)
        return {'message_ids': ['1', '2']}

    async def fail(self, claim, code, retryable):
        self.failed.append((code, retryable))
        return {}


class Sink:
    def __init__(self):
        self.events = []

    async def emit(self, kind, **payload):
        self.events.append((kind, payload))
        return True


def claim(**payload):
    return ChatClaim(operation_id='00000000-0000-0000-0000-000000000001',
        attempt_id='00000000-0000-0000-0000-000000000002', claim_generation=1,
        lease_expires_at=datetime.now(UTC) + timedelta(seconds=30),
        execution_deadline=datetime.now(UTC) + timedelta(seconds=120),
        payload={'conversation_id': 'chat-1', 'user_id': 'user-1', 'message': 'Help me prepare.',
                 'max_input_characters': 10000, 'summarize_every_user_messages': 20, **payload})


class Models:
    def __init__(self, function):
        self.model = FunctionModel(stream_function=function, model_name='gpt-6-luna')

    def accounted(self, owner, claimed, stage, model):
        return ChatModel(self.model, owner, claimed, stage, 'openai', 'gpt-6-luna')


@pytest.mark.anyio
async def test_reply_streams_then_accepts_once_and_accounts_actual_stream(monkeypatch):
    owner, sink, observed = Owner(), Sink(), []

    async def stream(messages, info):
        observed.extend(messages)
        assert not info.function_tools
        yield 'Practice one example'
        yield ' from your work.'

    adapter = ChatExecutionAdapter(owner, Models(stream))
    adapter._screen = AsyncMock()
    current = claim(messages=[{'role': 'user', 'content': 'I am changing careers.', 'position': 1},
                              {'role': 'assistant', 'content': 'What interests you?', 'position': 2}])
    await asyncio.wait_for(adapter.execute(current, sink), 5)
    assert owner.failed == []
    assert len(owner.accepted) == 1
    assert owner.accepted[0]['reply'] == 'Practice one example from your work.'
    adapter._screen.assert_awaited_once_with(current, 'Help me prepare.')
    assert sink.events[0][0] == 'started'
    assert sink.events[-1][0] == 'completed'
    assert ''.join(value['text'] for kind, value in sink.events if kind == 'delta') == owner.accepted[0]['reply']
    assert len(owner.starts) == 1
    assert len(owner.receipts) == 2
    assert owner.receipts[0][0] == owner.starts[0][0]
    assert owner.receipts[0][1][0]['cost_microdollars'] > 0
    assert owner.receipts[0][2] is False
    assert owner.receipts[-1] == (None, [], False)


@pytest.mark.anyio
async def test_required_screen_rejection_never_generates_or_streams(monkeypatch):
    owner, sink = Owner(), Sink()

    async def stream(messages, info):
        pytest.fail('Blocked input reached generation')
        yield ''

    adapter = ChatExecutionAdapter(owner, Models(stream))
    adapter._screen = AsyncMock(side_effect=ChatRejected('screening_blocked'))
    await adapter.execute(claim(), sink)
    assert owner.accepted == [] and owner.starts == []
    assert owner.failed == [('screening_blocked', False)]
    assert sink.events == [('failed', {})]


@pytest.mark.anyio
async def test_context_overflow_fails_without_screening_or_truncation():
    owner, sink = Owner(), Sink()

    async def stream(messages, info):
        pytest.fail('Oversized history reached generation')
        yield ''

    adapter = ChatExecutionAdapter(owner, Models(stream))
    adapter._screen = AsyncMock()
    messages = [{'role': 'user' if i % 2 == 0 else 'assistant', 'content': 'x' * 70000,
                 'position': i + 1} for i in range(2)]
    await adapter.execute(claim(messages=messages), sink)
    assert owner.failed == [('context_limit', False)]
    adapter._screen.assert_not_awaited()


@pytest.mark.anyio
async def test_cancelled_stream_retains_unknown_provider_receipt():
    owner, sink, started = Owner(), Sink(), asyncio.Event()

    async def stream(messages, info):
        yield 'Start'
        started.set()
        await asyncio.Event().wait()

    adapter = ChatExecutionAdapter(owner, Models(stream))
    adapter._screen = AsyncMock()
    task = asyncio.create_task(adapter.execute(claim(), sink))
    await asyncio.wait_for(started.wait(), 5)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert owner.accepted == []
    assert owner.receipts[0] == (owner.starts[0][0], [], True)
    assert owner.receipts[-1] == (None, [], False)
    assert sink.events[-1][0] == 'cancelled'

@pytest.mark.anyio
async def test_complete_stream_keeps_bill_when_consumer_validation_raises():
    from pydantic_ai.messages import ModelRequest, UserPromptPart
    from pydantic_ai.models import ModelRequestParameters
    owner = Owner()

    async def stream(messages, info):
        yield 'Complete reply'

    model = ChatModel(FunctionModel(stream_function=stream, model_name='gpt-6-luna'),
                      owner, claim(), 'reply', 'openai', 'gpt-6-luna')
    with pytest.raises(ValueError, match='rejected'):
        async with model.request_stream([ModelRequest(parts=[UserPromptPart('message')])],
                                         {}, ModelRequestParameters()) as response:
            async for _ in response:
                pass
            raise ValueError('rejected after full response')
    assert len(owner.receipts) == 1
    assert owner.receipts[0][1][0]['cost_microdollars'] > 0
    assert owner.receipts[0][2] is False


@pytest.mark.anyio
async def test_new_contact_stays_masked_at_provider_and_restores_at_public_boundary(monkeypatch):
    owner, sink, observed = Owner(), Sink(), []
    email = 'alex@example.test'
    def detect(text):
        start = text.find(email)
        return [(start, start + len(email), 'EMAIL_ADDRESS')] if start >= 0 else []
    monkeypatch.setattr('pii._detect_spans', detect)

    async def stream(messages, info):
        text = '\n'.join(part.content for message in messages for part in message.parts
                         if hasattr(part, 'content') and isinstance(part.content, str))
        observed.append(text)
        assert email not in text
        import re
        token = re.search(r'«pii:[^»]+»', text).group()
        yield 'Contact '
        yield token[:10]
        yield token[10:] + ' when ready.'

    adapter = ChatExecutionAdapter(owner, Models(stream))
    adapter._screen = AsyncMock()
    await adapter.execute(claim(message='My email is ' + email), sink)
    assert owner.accepted[0]['reply'] == 'Contact alex@example.test when ready.'
    assert ''.join(data['text'] for kind, data in sink.events if kind == 'delta') == owner.accepted[0]['reply']
    assert email not in adapter._screen.await_args.args[1]
    assert observed


@pytest.mark.anyio
async def test_real_screen_policy_keeps_jev_primary_and_does_not_fallback_on_block(monkeypatch):
    from pydantic_ai.usage import RunUsage

    from agents.user_text_screen_agent import UserTextScreenRun
    from schemas.user_text_screen import UserTextScreen
    owner = Owner()
    async def unused(messages, info):
        yield ''
    adapter = ChatExecutionAdapter(owner, Models(unused))
    called = []
    async def blocked(text, model, timeout):
        called.append(model)
        return UserTextScreenRun(UserTextScreen(prompt_injection=True, harmful_request=False),
                                 'jev-1.13.0', {'prompt_injection': 1.0}, RunUsage())
    monkeypatch.setattr('chat.execution.screen_user_message_async', blocked)
    fallback = AsyncMock()
    monkeypatch.setattr('chat.execution.screen_fallback_message_async', fallback)
    with pytest.raises(ChatRejected, match='screening_blocked'):
        await adapter._screen(claim(), 'ordinary looking text')
    assert called == ['typesafe:jev-1.13.0']
    fallback.assert_not_awaited()

@pytest.mark.anyio
async def test_buffer_outage_still_accepts_reply_without_second_provider():
    owner = Owner()
    class UnavailableSink(Sink):
        async def emit(self, kind, **payload):
            self.events.append((kind, payload))
            return False
    sink = UnavailableSink()
    async def stream(messages, info):
        yield 'Make a short practice plan.'
    adapter = ChatExecutionAdapter(owner, Models(stream))
    adapter._screen = AsyncMock()
    await adapter.execute(claim(), sink)
    assert len(owner.accepted) == len(owner.starts) == 1
    assert owner.failed == []


@pytest.mark.anyio
async def test_ambiguous_acceptance_reads_canonical_state_without_regeneration():
    from interviews.client import RailsTransportError
    owner = Owner()
    owner.accept = AsyncMock(side_effect=RailsTransportError('lost receipt'))
    owner.status = AsyncMock(return_value={'operation_id': claim().operation_id, 'status': 'accepted'})
    async def stream(messages, info):
        yield 'Saved reply'
    adapter = ChatExecutionAdapter(owner, Models(stream))
    adapter._screen = AsyncMock()
    sink = Sink()
    await adapter.execute(claim(), sink)
    assert len(owner.starts) == 1
    owner.accept.assert_awaited_once()
    owner.status.assert_awaited_once_with(claim().operation_id)
    assert sink.events[-1][0] == 'completed'


@pytest.mark.anyio
async def test_chat_client_uses_shared_bounded_transport_with_separate_claim_contract():
    import httpx

    from chat.client import RailsChatClient
    current = claim()
    paths = []
    def respond(request):
        paths.append(request.url.path)
        assert request.headers['authorization'] == 'Bearer test-service'
        return httpx.Response(200, json=current.model_dump(mode='json'))
    async with RailsChatClient('http://rails.test', 'test-service', transport=httpx.MockTransport(respond)) as client:
        saved = await client.claim(current.operation_id)
    assert saved == current
    assert paths == [f'/internal/chat/operations/{current.operation_id}/claim']


def test_chat_claim_rejects_incomplete_or_out_of_order_history():
    from pydantic import ValidationError
    with pytest.raises(ValidationError, match='complete accepted exchanges'):
        claim(messages=[{'role': 'user', 'content': 'Unfinished', 'position': 1}])
    with pytest.raises(ValidationError, match='authoritative limit'):
        claim(message='too long', max_input_characters=2)


def test_chat_model_configuration_is_explicit_and_bounded(monkeypatch):
    from pydantic import ValidationError

    from settings import AISettings
    assert AISettings(chat_model='openai:gpt-5-nano').chat_model == 'openai:gpt-5-nano'
    with pytest.raises(ValidationError, match='Chat supports'):
        AISettings(chat_model='arbitrary-provider:model')

@pytest.mark.anyio
async def test_provider_outage_uses_configured_fallback_and_retains_both_receipts():
    from pydantic_ai.exceptions import ModelHTTPError
    owner, sink = Owner(), Sink()
    async def unavailable(messages, info):
        raise ModelHTTPError(503, 'gpt-6-luna', 'unavailable')
        yield ''
    async def fallback(messages, info):
        yield 'A useful fallback reply.'
    class BothModels:
        def accounted(self, owner, current, stage, model):
            name = model.removeprefix('openai:')
            function = unavailable if name == 'gpt-6-luna' else fallback
            return ChatModel(FunctionModel(stream_function=function, model_name=name),
                             owner, current, stage, 'openai', name)
    adapter = ChatExecutionAdapter(owner, BothModels())
    adapter._screen = AsyncMock()
    await adapter.execute(claim(), sink)
    assert owner.accepted[0]['reply'] == 'A useful fallback reply.'
    assert [record[3] for record in owner.starts] == ['gpt-6-luna', 'gpt-5-nano']
    assert owner.receipts[0][2] is True and owner.receipts[1][2] is False


@pytest.mark.anyio
async def test_exhausted_provider_fallback_has_recoverable_failure_state():
    from pydantic_ai.exceptions import ModelHTTPError
    owner, sink = Owner(), Sink()
    async def unavailable(messages, info):
        raise ModelHTTPError(503, 'gpt-6-luna', 'unavailable')
        yield ''
    adapter = ChatExecutionAdapter(owner, Models(unavailable))
    adapter._screen = AsyncMock()
    await adapter.execute(claim(), sink)
    assert owner.failed == [('dependency_unavailable', True)]
    assert owner.accepted == []
    assert len(owner.starts) == 2
    assert sink.events[-1][0] == 'failed'
