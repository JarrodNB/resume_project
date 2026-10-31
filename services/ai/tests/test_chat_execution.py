"""Exercise chat through its guarded streaming execution adapter without providers."""
import asyncio
from contextlib import contextmanager
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import logfire
import pytest
from psycopg import OperationalError
from pydantic_ai.models.function import FunctionModel

from chat.client import ChatClaim
from chat.execution import ChatExecutionAdapter, ChatRejected
from chat.models import ChatModel
from tests import test_tracing


@pytest.fixture
def exporters():
    yield from test_tracing.exporters.__wrapped__()


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
    monkeypatch.setattr('screening.conversation.screen_user_message_async', blocked)
    fallback = AsyncMock()
    monkeypatch.setattr('screening.conversation.screen_fallback_message_async', fallback)
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
    current = claim().model_dump(mode='json')
    current['payload'] = {'version': 1, 'conversation_id': 'chat-1', 'user_id': 'user-1',
        'expected_position': 0, 'summary_base_version': 0, 'summary_through_position': 0,
        'summary_plan': None, 'max_input_characters': 10000, 'summarize_every_user_messages': 20}
    paths = []
    def respond(request):
        paths.append(request.url.path)
        assert request.headers['authorization'] == 'Bearer test-service'
        return httpx.Response(200, json=current)
    async with RailsChatClient('http://rails.test', 'test-service', transport=httpx.MockTransport(respond)) as client:
        saved = await client.claim(current["operation_id"])
    assert saved.model_dump(mode='json') == current
    assert paths == [f'/internal/chat/operations/{current['operation_id']}/claim']


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
async def test_provider_outage_uses_configured_fallback_and_retains_both_receipts(exporters, monkeypatch):
    from opentelemetry import trace
    from pydantic_ai import InstrumentationSettings
    from pydantic_ai.exceptions import ModelHTTPError

    from chat.execution import make_chat_agent

    def instrumented_agent(*args, **kwargs):
        agent = make_chat_agent(*args, **kwargs)
        agent.instrument = InstrumentationSettings(tracer_provider=trace.get_tracer_provider())
        return agent

    monkeypatch.setattr('chat.execution.make_chat_agent', instrumented_agent)
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
    logfire.force_flush(timeout_millis=1000)
    spans = [span for span in exporters[0].get_finished_spans()
             if "model_attempt.role" in span.attributes]
    assert [span.attributes["logfire.msg"] for span in spans] == [
        "Primary model attempt: function:gpt-6-luna",
        "Fallback model attempt: function:gpt-5-nano",
    ]
    assert all("operation.cost" not in span.attributes for span in spans)
    requests = [span for span in exporters[0].get_finished_spans()
                if span.attributes.get("gen_ai.operation.name") == "chat"]
    assert requests[0].attributes.get("chat_operation_id") == claim().operation_id
    assert [span.name for span in requests] == ["chat model request"]
    assert requests[0].attributes["gen_ai.request.model"].startswith("fallback:")


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


def test_rolling_claim_starts_after_covered_checkpoint_and_preserves_complete_history():
    current = claim(summary={'text': 'Earlier career goals.', 'version': 1, 'through_position': 30},
        messages=[{'role': 'user', 'content': 'Recent question', 'position': 31},
                  {'role': 'assistant', 'content': 'Recent answer', 'position': 32}])
    assert current.payload.messages[0].position == 31
    assert current.payload.summary.through_position == 30


def memory_history(first_turn, last_turn):
    return [message for turn in range(first_turn, last_turn + 1) for message in (
        {'role': 'user', 'content': f'[U{turn}] career detail', 'position': turn * 2 - 1},
        {'role': 'assistant', 'content': f'[A{turn}] guidance', 'position': turn * 2})]


def model_text(messages):
    return '\n'.join(part.content for message in messages for part in message.parts
                     if isinstance(getattr(part, 'content', None), str))


class MemoryModels:
    def __init__(self, summary_output=None):
        self.summary_output = summary_output
        self.summary_inputs = []
        self.reply_inputs = []

    def accounted(self, owner, claimed, stage, model):
        from pydantic_ai.messages import ModelResponse, TextPart

        def summarize(messages, info):
            self.summary_inputs.append(model_text(messages))
            return ModelResponse(parts=[TextPart(self.summary_output if self.summary_output is not None else
                f'Rolling memory {len(self.summary_inputs)}')])

        async def reply(messages, info):
            self.reply_inputs.append(model_text(messages))
            yield 'Career advice'

        provider = FunctionModel(summarize, stream_function=reply, model_name='gpt-6-luna')
        return ChatModel(provider, owner, claimed, stage, 'openai', 'gpt-6-luna')


@pytest.mark.anyio
async def test_two_rolling_checkpoints_and_interim_context_keep_all_uncovered_turns():
    owner, models = Owner(), MemoryModels()
    adapter = ChatExecutionAdapter(owner, models)
    adapter._screen = AsyncMock()
    first = claim(messages=memory_history(1, 19), summary_plan={'through_position': 30, 'scheduled': True})
    await asyncio.wait_for(adapter.execute(first, Sink()), 5)
    update = owner.accepted[-1]['summary_update']
    assert update == {'text': 'Rolling memory 1', 'expected_version': 0, 'through_position': 30}
    assert '[U15]' in models.summary_inputs[0] and '[U16]' not in models.summary_inputs[0]
    assert '[U19]' in models.reply_inputs[0] and '[U1]' in models.reply_inputs[0]
    assert [entry[1] for entry in owner.starts] == ['reply', 'summary']

    summary = {'text': update['text'], 'version': 1, 'through_position': 30}
    await adapter.execute(claim(summary=summary, messages=memory_history(16, 20)), Sink())
    assert 'Rolling memory 1' in models.reply_inputs[1]
    assert all(f'[U{i}]' in models.reply_inputs[1] for i in range(16, 21))
    assert 'summary_update' not in owner.accepted[-1]

    await adapter.execute(claim(summary=summary, messages=memory_history(16, 39),
        summary_plan={'through_position': 70, 'scheduled': True}), Sink())
    assert 'Rolling memory 1' in models.summary_inputs[1]
    assert '[U16]' in models.summary_inputs[1] and '[U35]' in models.summary_inputs[1]
    assert '[U15]' not in models.summary_inputs[1] and '[U36]' not in models.summary_inputs[1]
    assert owner.accepted[-1]['summary_update']['through_position'] == 70
    assert owner.accepted[-1]['summary_update']['expected_version'] == 1
    assert adapter._screen.await_count == 3
    assert not owner.failed


@pytest.mark.anyio
async def test_early_compaction_precedes_reply_and_keeps_five_complete_exchanges():
    owner, models = Owner(), MemoryModels()
    adapter = ChatExecutionAdapter(owner, models)
    adapter._screen = AsyncMock()
    history = memory_history(1, 7)
    for item in history:
        item['content'] += 'x' * (10000 if item['role'] == 'user' else 8000)
    current = claim(messages=history, summary_plan={'through_position': 4, 'scheduled': False})
    await asyncio.wait_for(adapter.execute(current, Sink()), 5)
    assert not owner.failed
    assert [entry[1] for entry in owner.starts] == ['summary', 'reply']
    assert '[U1]' in models.summary_inputs[0] and '[U2]' in models.summary_inputs[0]
    assert '[U3]' not in models.summary_inputs[0]
    assert '[U1]' not in models.reply_inputs[0] and 'Rolling memory 1' in models.reply_inputs[0]
    assert all(f'[U{i}]' in models.reply_inputs[0] for i in range(3, 8))
    adapter._screen.assert_awaited_once()
    assert owner.accepted[-1]['summary_update']['through_position'] == 4


@pytest.mark.anyio
async def test_failed_scheduled_summary_discards_provisional_reply_but_keeps_known_charges():
    owner, models, sink = Owner(), MemoryModels(summary_output=' '), Sink()
    adapter = ChatExecutionAdapter(owner, models)
    adapter._screen = AsyncMock()
    await asyncio.wait_for(adapter.execute(claim(messages=memory_history(1, 19),
        summary_plan={'through_position': 30, 'scheduled': True}), sink), 5)
    assert owner.accepted == []
    assert owner.failed == [('execution_failed', False)]
    assert sink.events[-1][0] == 'failed'
    assert any(kind == 'delta' for kind, _ in sink.events)
    assert [entry[1] for entry in owner.starts] == ['reply', 'summary', 'summary']
    assert all(entries and not incomplete for observation, entries, incomplete in owner.receipts if observation)


@pytest.mark.parametrize('changes', [
    {'summary': {'text': 'Fake', 'version': 1, 'through_position': 3}},
    {'summary': {'text': '', 'version': 1, 'through_position': 2}},
    {'summary_plan': {'through_position': 32, 'scheduled': True}},
    {'summary_plan': {'through_position': 30, 'scheduled': False}},
])
def test_claim_rejects_unfenced_or_incomplete_summary_ranges(changes):
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        claim(messages=memory_history(1, 19), **changes)


@pytest.mark.anyio
async def test_oversized_minimum_recent_window_fails_without_screening_or_generation():
    owner, models = Owner(), MemoryModels()
    adapter = ChatExecutionAdapter(owner, models)
    adapter._screen = AsyncMock()
    history = memory_history(1, 7)
    for item in history:
        if item['position'] >= 5:
            item['content'] += 'x' * 13000
    await asyncio.wait_for(adapter.execute(claim(messages=history,
        summary_plan={'through_position': 4, 'scheduled': False}), Sink()), 5)
    assert owner.failed == [('context_limit', False)]
    assert not owner.starts and not owner.accepted
    adapter._screen.assert_not_awaited()


@pytest.mark.anyio
async def test_rolling_summary_contacts_are_masked_for_both_models_and_restored_only_at_acceptance(monkeypatch):
    import re

    from pydantic_ai.messages import ModelResponse, TextPart

    email = 'alex@example.test'
    def detect(text):
        start = text.find(email)
        return [(start, start + len(email), 'EMAIL_ADDRESS')] if start >= 0 else []
    monkeypatch.setattr('pii._detect_spans', detect)
    observed = []

    def summarize(messages, info):
        text = model_text(messages)
        observed.append(text)
        assert email not in text
        token = re.search(r'«pii:[^»]+»', text).group()
        return ModelResponse(parts=[TextPart('User contact: ' + token)])

    async def reply(messages, info):
        text = model_text(messages)
        observed.append(text)
        assert email not in text
        yield 'We can discuss your next step.'

    class ContactModels:
        def accounted(self, owner, current, stage, model):
            provider = FunctionModel(summarize, stream_function=reply, model_name='gpt-6-luna')
            return ChatModel(provider, owner, current, stage, 'openai', 'gpt-6-luna')

    owner = Owner()
    adapter = ChatExecutionAdapter(owner, ContactModels())
    adapter._screen = AsyncMock()
    await asyncio.wait_for(adapter.execute(claim(summary={'text': 'Contact: ' + email, 'version': 1, 'through_position': 30},
        messages=memory_history(16, 22), summary_plan={'through_position': 34, 'scheduled': False}), Sink()), 5)
    assert owner.accepted[-1]['summary_update']['text'] == 'User contact: ' + email
    assert len(observed) == 2 and not owner.failed
    adapter._screen.assert_awaited_once()



@contextmanager
def tool_server(library):
    """Run the real MCP tool server over local HTTP with a synthetic library."""
    from mcp_tools.client import ToolServerConnection
    from mcp_tools.local_server import serve_in_background
    from mcp_tools.server import create_mcp_server

    reads, secret = [], 'chat-test-secret-0123456789abcdefghij'

    def read(user_id):
        reads.append(user_id)
        return library

    app = create_mcp_server(secret=secret, read_library=read).http_app(path='/mcp', stateless_http=True)
    with serve_in_background(app) as url:
        yield ToolServerConnection(url=url, secret=secret), reads


def tool_returns(messages):
    from pydantic_ai.messages import ToolReturnPart

    return [part for message in messages for part in message.parts if isinstance(part, ToolReturnPart)]


@pytest.mark.anyio
async def test_reply_reads_the_owners_library_from_the_tool_server_and_keeps_its_preamble():
    from pydantic_ai.models.function import DeltaToolCall

    from schemas.gap_analysis_context import CareerLibrary

    owner, sink = Owner(), Sink()
    library = CareerLibrary.model_validate({"skills": [{"id": "s1", "name": "Ruby", "screened_fields": ["name"]}]})

    async def stream(messages, info):
        assert {tool.name for tool in info.function_tools} == {'read_career_library', 'list_saved_jobs', 'read_job_summary'}
        returns = tool_returns(messages)
        if not returns:
            # GPT models often write a short preamble before calling a tool.
            yield 'Let me check your library.'
            yield {1: DeltaToolCall(name='read_career_library', json_args='{}', tool_call_id='call-1')}
        else:
            # Readable, screened text only: no JSON, IDs or saved check status.
            assert '- Ruby' in returns[0].content and 's1' not in returns[0].content
            yield 'You list Ruby as a skill.'

    with tool_server(library) as (connection, reads):
        adapter = ChatExecutionAdapter(owner, Models(stream), tool_server=connection)
        adapter._screen = AsyncMock()
        await asyncio.wait_for(adapter.execute(claim(), sink), 10)
    assert owner.failed == []
    # The server read only the claim's owner, taken from the signed token.
    assert reads == ['user-1']
    reply = owner.accepted[0]['reply']
    assert reply == 'Let me check your library.\n\nYou list Ruby as a skill.'
    assert ''.join(value['text'] for kind, value in sink.events if kind == 'delta') == reply
    # Both model requests in the run are accounted separately.
    assert len(owner.starts) == 2
    assert all(entry[1][0]['cost_microdollars'] > 0 for entry in owner.receipts[:2])


@pytest.mark.anyio
async def test_unchecked_library_text_is_screened_on_the_claims_accounted_screen():
    from types import SimpleNamespace

    from pydantic_ai.models.function import DeltaToolCall

    from schemas.gap_analysis_context import CareerLibrary

    owner, sink = Owner(), Sink()
    library = CareerLibrary.model_validate({"skills": [{"id": "s1", "name": "Ruby"}]})

    async def stream(messages, info):
        returns = tool_returns(messages)
        if not returns:
            yield {0: DeltaToolCall(name='read_career_library', json_args='{}', tool_call_id='call-1')}
        else:
            pytest.fail("Blocked library content must stop before another model request")


    current = claim()
    with tool_server(library) as (connection, _):
        adapter = ChatExecutionAdapter(owner, Models(stream), tool_server=connection)
        adapter._screen = AsyncMock()
        adapter._screen_decision = AsyncMock(return_value=SimpleNamespace(allowed=False, too_long=False, unchecked=False))
        await asyncio.wait_for(adapter.execute(current, sink), 10)
    assert not owner.accepted
    assert owner.failed == [('screening_blocked', False)]
    adapter._screen_decision.assert_awaited_once()
    assert adapter._screen_decision.await_args.args[0] is current


@pytest.mark.anyio
async def test_reply_still_answers_without_tools_when_the_tool_server_is_down():
    from mcp_tools.client import ToolServerConnection

    owner, sink = Owner(), Sink()

    async def stream(messages, info):
        assert not info.function_tools
        yield 'I can still help from what you tell me.'

    down = ToolServerConnection(url='http://127.0.0.1:9/mcp', secret='chat-test-secret-0123456789abcdefghij')
    adapter = ChatExecutionAdapter(owner, Models(stream), tool_server=down)
    adapter._screen = AsyncMock()
    await asyncio.wait_for(adapter.execute(claim(), sink), 10)
    assert owner.failed == []
    assert owner.accepted[0]['reply'] == 'I can still help from what you tell me.'


@pytest.mark.anyio
async def test_new_library_approvals_are_sent_with_chat_acceptance():
    import hashlib
    import json

    from pydantic_ai.models.function import DeltaToolCall

    from schemas.gap_analysis_context import CareerLibrary
    from screening.screen_user_text import ScreenOutcome

    owner, sink = Owner(), Sink()
    library = CareerLibrary(skills=[{"id": "s1", "name": "Ruby"}])

    async def stream(messages, info):
        if not tool_returns(messages):
            yield {0: DeltaToolCall(name="read_career_library", json_args="{}", tool_call_id="call-1")}
        else:
            yield "You list Ruby."

    with tool_server(library) as (connection, _):
        adapter = ChatExecutionAdapter(owner, Models(stream), tool_server=connection)
        adapter._screen = AsyncMock()
        adapter._screen_decision = AsyncMock(return_value=ScreenOutcome(True))
        await asyncio.wait_for(adapter.execute(claim(), sink), 10)
    assert not owner.failed
    assert "library_screening" not in owner.accepted[0]
    # The tool's library check is billed to this chat operation's screen.
    adapter._screen_decision.assert_awaited_once()
    report = owner.accepted[0]["record_screening"][0]
    assert report == {"record_type": "skill", "record_id": "s1", "revision": {},
        "fingerprints": {"name": hashlib.sha256(json.dumps("Ruby").encode()).hexdigest()}}


@pytest.mark.anyio
@pytest.mark.parametrize("error,retryable", [(ValueError("stale claim"), False),
    (OperationalError("offline database unavailable"), True)])
async def test_failed_reference_read_never_screens_or_starts_models(error, retryable):
    from chat.client import ChatReferencePayload
    owner = Owner()
    def reject(_):
        raise error
    adapter = ChatExecutionAdapter(owner, Models(lambda *_: None), input_reader=reject)
    adapter._screen = AsyncMock()
    current = claim().model_copy(update={"payload": ChatReferencePayload(version=1,
        conversation_id="chat-1", user_id="user-1", expected_position=0, summary_base_version=0,
        summary_through_position=0, max_input_characters=10000, summarize_every_user_messages=20)})
    await adapter.execute(current, Sink())
    assert owner.starts == [] and owner.accepted == []
    assert owner.failed == [("dependency_unavailable" if retryable else "execution_failed", retryable)]
    assert owner.receipts == [(None, [], False)]
    adapter._screen.assert_not_awaited()


@pytest.mark.anyio
async def test_http_claim_refuses_inline_source_even_when_authenticated():
    import httpx

    from chat.client import RailsChatClient
    from interviews.client import RailsTransportError
    current = claim()
    async with RailsChatClient('http://rails.test', 'test-service', transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json=current.model_dump(mode='json')))) as client:
        with pytest.raises(RailsTransportError, match='Invalid chat claim'):
            await client.claim(current.operation_id)


@pytest.mark.anyio
async def test_reply_lists_saved_jobs_then_reads_summary_with_accounted_checks():
    from uuid import uuid4

    from pydantic_ai.models.function import DeltaToolCall

    from mcp_tools.client import ToolServerConnection
    from mcp_tools.local_server import serve_in_background
    from mcp_tools.server import create_mcp_server
    from schemas.gap_analysis_context import CareerLibrary
    from screening.screen_user_text import ScreenOutcome

    owner, sink, reads = Owner(), Sink(), []
    job_id = str(uuid4())
    def read(user):
        reads.append(user)
        return [{"id": job_id, "title": "Platform Engineer", "company": "Acme", "screened_fields": []}]
    def detail(user, selected):
        assert user == "user-1" and selected == job_id
        return {"id": job_id, "title": "Platform Engineer", "company": "Acme", "location": "Remote",
                    "requirements": ["Python"], "responsibilities": [], "nice_to_haves": [], "screened_fields": []}
    async def stream(messages, info):
        returns = tool_returns(messages)
        if not returns:
            yield {0: DeltaToolCall(name="list_saved_jobs", json_args="{}", tool_call_id="list-1")}
        else:
            text = returns[0].content
            assert "Title: Platform Engineer" in text and "Company: Acme" in text
            assert "Reference: J-" in text and job_id not in text
            if len(returns) == 1:
                import json
                reference = text.split("Reference: ")[1].splitlines()[0]
                yield {0: DeltaToolCall(name="read_job_summary", json_args=json.dumps({"job_reference": reference}), tool_call_id="summary-1")}
            else:
                assert "Location: Remote" in returns[1].content
                yield "You saved Platform Engineer at Acme, a remote Python role."
    secret = "saved-chat-secret-0123456789abcdefghij"
    app = create_mcp_server(secret=secret, read_library=lambda _: CareerLibrary(), read_jobs=read, read_job_summary=detail).http_app(
        path="/mcp", stateless_http=True)
    with serve_in_background(app) as url:
        adapter = ChatExecutionAdapter(owner, Models(stream), tool_server=ToolServerConnection(url=url, secret=secret))
        adapter._screen = AsyncMock()
        adapter._screen_decision = AsyncMock(return_value=ScreenOutcome(True))
        await asyncio.wait_for(adapter.execute(claim(), sink), 10)
    assert not owner.failed and reads == ["user-1"]
    assert owner.accepted[0]["reply"] == "You saved Platform Engineer at Acme, a remote Python role."
    assert adapter._screen_decision.await_count == 2
    report = owner.accepted[0]["record_screening"][0]
    assert report["record_type"] == "job" and report["record_id"] == job_id
    assert set(report["fingerprints"]) == {"title", "company", "location", "requirements"}


@pytest.mark.anyio
async def test_job_and_background_advice_screens_all_sources_with_bounded_approval_receipts():
    """All three reads fit one reply; optional approval receipts cannot reject it."""
    import json
    from uuid import uuid4

    from pydantic_ai.models.function import DeltaToolCall

    from mcp_tools.client import ToolServerConnection
    from mcp_tools.local_server import serve_in_background
    from mcp_tools.server import create_mcp_server
    from schemas.gap_analysis_context import CareerLibrary
    from screening.screen_user_text import ScreenOutcome

    owner, sink, screened = Owner(), Sink(), []
    jobs = [{"id": str(uuid4()), "title": "E", "company": "C", "screened_fields": []}
            for _ in range(400)]
    library = CareerLibrary(skills=[{"id": str(uuid4()), "name": f"Python skill {i}"}
                                   for i in range(101)])
    async def screen(text):
        screened.append(text)
        return ScreenOutcome(True)
    def detail(user, selected):
        assert user == "user-1" and selected == jobs[0]["id"]
        return {**jobs[0], "location": "Remote", "requirements": ["Python"],
                "responsibilities": [], "nice_to_haves": []}
    async def stream(messages, info):
        returns = tool_returns(messages)
        if not returns:
            yield {0: DeltaToolCall(name="list_saved_jobs", json_args="{}", tool_call_id="list")}
        elif len(returns) == 1:
            reference = returns[0].content.split("Reference: ")[1].splitlines()[0]
            yield {0: DeltaToolCall(name="read_job_summary", json_args=json.dumps({"job_reference": reference}), tool_call_id="summary")}
        elif len(returns) == 2:
            yield {0: DeltaToolCall(name="read_career_library", json_args="{}", tool_call_id="library")}
        else:
            assert "Python" in returns[1].content
            assert "Python skill 100" in returns[2].content
            yield "Your saved Python skills relate to the role's Python requirement."
    secret = "combined-tools-test-secret-0123456789abcdef"
    app = create_mcp_server(secret=secret, read_library=lambda _: library,
                            read_jobs=lambda _: jobs, read_job_summary=detail).http_app(
                                path="/mcp", stateless_http=True)
    with serve_in_background(app) as url:
        adapter = ChatExecutionAdapter(owner, Models(stream),
            tool_server=ToolServerConnection(url=url, secret=secret))
        adapter._screen = AsyncMock()
        async def accounted_screen(*args):
            return await screen(args[-1])
        adapter._screen_decision = AsyncMock(side_effect=accounted_screen)
        await asyncio.wait_for(adapter.execute(claim(), sink), 15)
    assert not owner.failed
    assert owner.accepted[0]["reply"].startswith("Your saved Python skills")
    assert len(owner.accepted[0]["record_screening"]) == 500
    assert any("Python skill 100" in text for text in screened)
