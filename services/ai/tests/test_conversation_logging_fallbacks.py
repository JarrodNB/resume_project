"""Observe real fallback execution without turning nearby requests into fallback events."""
import asyncio
from uuid import uuid4

import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from conversation_logging import ConversationLogging, conversation_scope
from tests.test_process_task_message import build_task_body
from tests.test_tracing import exporters  # noqa: F401 - shared in-memory trace fixture
from worker.generative_model import generative_model
from worker.queue_messages import AiTaskMessage
from worker.settings import WorkerSettings
from worker.task_usage import collect_task_usage


def scope(settings):
    return conversation_scope(AiTaskMessage.model_validate_json(build_task_body()), settings, uuid4(), 1)


@pytest.mark.parametrize('failed', [False, True])
def test_generative_fallback_execution(monkeypatch, tmp_path, failed):
    monkeypatch.chdir(tmp_path)
    def primary(messages, info):
        raise ModelHTTPError(503, 'primary', 'private payload')
    def fallback(messages, info):
        if failed:
            raise ModelHTTPError(503, 'fallback', 'private payload')
        return ModelResponse(parts=[TextPart('ok')])
    with scope(WorkerSettings(worker_environment='local')), collect_task_usage():
        agent = Agent(generative_model(FunctionModel(primary, model_name='primary'),
                                       FunctionModel(fallback, model_name='fallback')),
                      capabilities=[ConversationLogging()])
        if failed:
            with pytest.raises(ExceptionGroup):
                agent.run_sync('answer')
        else:
            assert agent.run_sync('answer').output == 'ok'
    text = next(tmp_path.glob('conversation_logs/**/*.md')).read_text()
    assert text.count('### FALLBACK EXECUTION') == 1
    assert 'From model: function:primary' in text
    assert 'To model: function:fallback' in text
    assert 'Run:' in text and 'Fallback execution:' in text
    assert 'private payload' not in text


@pytest.mark.parametrize('environment,enabled', [('local', True), ('local', False), ('production', True)])
@pytest.mark.parametrize('async_path', [False, True])
@pytest.mark.parametrize('failed', [False, True])
def test_screening_fallback_execution(monkeypatch, tmp_path, offline_model_resolution, async_path, failed, environment, enabled):
    from agents.user_text_screen_agent import screen_user_message_async
    from screening.screen_user_text import screen_user_text, screen_user_text_async
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('TYPESAFE_API_KEY', 'offline')
    def primary(messages, info):
        raise ModelHTTPError(503, 'jev', 'private payload')
    def fallback(messages, info):
        if failed:
            raise ModelHTTPError(503, 'nano', 'private payload')
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
                              {'prompt_injection': False, 'harmful_request': False})])
    offline_model_resolution('typesafe:jev-1.13.0', FunctionModel(primary))
    offline_model_resolution('openai:gpt-5-nano', FunctionModel(fallback))
    with scope(WorkerSettings(worker_environment=environment, conversation_logging_enabled=enabled)), collect_task_usage():
        if async_path:
            outcome = asyncio.run(screen_user_text_async('Career notes', 'typesafe:jev-1.13.0', 5,
                                  classify=screen_user_message_async))
        else:
            outcome = screen_user_text('Career notes', 'typesafe:jev-1.13.0', 5)
    assert outcome.allowed == (not failed)
    if environment != 'local' or not enabled:
        assert not (tmp_path / 'conversation_logs').exists()
        return
    text = next(tmp_path.glob('conversation_logs/**/*.md')).read_text()
    assert text.count('### FALLBACK EXECUTION') == 1
    assert 'From model: typesafe:jev-1.13.0' in text
    assert 'To model: openai:gpt-5-nano' in text
    import re
    execution = re.search(r'Fallback execution: ([a-f0-9-]+)', text)[1]
    assert text.count(f'Fallback execution: {execution}') >= 2


@pytest.mark.parametrize('async_path', [False, True])
def test_local_primary_fallback_is_linked_in_transcript(
    monkeypatch, tmp_path, offline_model_resolution, async_path,
):
    from agents.user_text_screen_agent import screen_user_message_async
    from screening import local_llama
    from screening.screen_user_text import screen_user_text, screen_user_text_async

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv('USER_TEXT_SCREEN_FALLBACK_MODEL', 'openai:gpt-5-nano')
    monkeypatch.setattr(local_llama, 'iter_chunks', lambda text: iter([(text, len(text))]))

    def unavailable(*_args):
        raise RuntimeError('Local model unavailable')

    monkeypatch.setattr(local_llama, 'classify_chunk', unavailable)
    offline_model_resolution('openai:gpt-5-nano', FunctionModel(
        lambda messages, info: ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
                                               {'prompt_injection': False})])))
    with scope(WorkerSettings(worker_environment='local')), collect_task_usage():
        if async_path:
            outcome = asyncio.run(screen_user_text_async(
                'Career notes', local_llama.MODEL, 5, classify=screen_user_message_async))
        else:
            outcome = screen_user_text('Career notes', local_llama.MODEL, 5)
    assert outcome.allowed
    text = next(tmp_path.glob('conversation_logs/**/*.md')).read_text()
    assert text.count('### FALLBACK EXECUTION') == 1
    assert f'From model: {local_llama.MODEL}' in text
    assert 'To model: openai:gpt-5-nano' in text
    import re
    execution = re.search(r'Fallback execution: ([a-f0-9-]+)', text)[1]
    assert text.count(f'Fallback execution: {execution}') >= 2


@pytest.mark.parametrize('environment,enabled', [('production', True), ('local', False)])
def test_disabled_transcripts_keep_validation_fallback_and_tracing(monkeypatch, tmp_path, environment, enabled, exporters):  # noqa: F811 - pytest fixture
    """Disabled capture still runs fallback and validation beneath an independent trace."""
    import conversation_logging
    monkeypatch.chdir(tmp_path)
    def unexpected(*args, **kwargs):
        pytest.fail('Disabled logging rendered transcript content')
    monkeypatch.setattr(conversation_logging, 'render_messages', unexpected)
    calls = []
    def primary(messages, info):
        raise ModelHTTPError(503, 'primary', 'unavailable')
    def fallback(messages, info):
        calls.append(True)
        value = 'bad' if len(calls) == 1 else 42
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {'response': value})])
    import logfire
    from opentelemetry import trace
    from pydantic_ai.models.instrumented import InstrumentationSettings
    Agent.instrument_all(InstrumentationSettings(tracer_provider=trace.get_tracer_provider()))
    settings = WorkerSettings(worker_environment=environment, conversation_logging_enabled=enabled)
    with scope(settings), collect_task_usage():
        agent = Agent(generative_model(FunctionModel(primary), FunctionModel(fallback)),
                      output_type=int, capabilities=[ConversationLogging()])
        assert agent.run_sync('answer').output == 42
    logfire.force_flush(timeout_millis=1000)
    assert exporters[0].get_finished_spans()
    assert len(calls) == 2
    assert not (tmp_path / 'conversation_logs').exists()


@pytest.mark.parametrize('nested', [False, True])
def test_unrelated_requests_never_look_like_fallback(monkeypatch, tmp_path, nested):
    """Concurrent and nested runs with different models are ordinary requests."""
    monkeypatch.chdir(tmp_path)
    async def exercise():
        async def respond(messages, info):
            if nested:
                await child.run('child')
            await asyncio.sleep(0)
            return ModelResponse(parts=[TextPart('ok')])
        model = FunctionModel(lambda m, i: ModelResponse(parts=[TextPart('ok')]), model_name='child')
        child = Agent(generative_model(model, model), capabilities=[ConversationLogging()])
        primary = FunctionModel(respond, model_name='parent')
        parent = Agent(generative_model(primary, model), capabilities=[ConversationLogging()])
        if nested:
            assert (await parent.run('parent')).output == 'ok'
        else:
            assert [r.output for r in await asyncio.gather(parent.run('parent'), child.run('child'))] == ['ok', 'ok']
    with scope(WorkerSettings(worker_environment='local')), collect_task_usage():
        asyncio.run(exercise())
    assert '### FALLBACK' not in next(tmp_path.glob('conversation_logs/**/*.md')).read_text()


def test_failed_append_preserves_fallback_error(monkeypatch, tmp_path):
    """A disk failure cannot replace the fallback chain's original exceptions."""
    import conversation_logging
    monkeypatch.chdir(tmp_path)
    errors = [ModelHTTPError(503, name, 'unavailable') for name in ('primary', 'fallback')]
    def fail(index):
        def respond(messages, info):
            raise errors[index]
        return FunctionModel(respond, model_name=str(index))
    with scope(WorkerSettings(worker_environment='local')), collect_task_usage() as usage:
        def broken_append(*args):
            raise OSError('disk failed')
        monkeypatch.setattr(conversation_logging.Transcript, 'append', broken_append)
        with pytest.raises(ExceptionGroup) as caught:
            Agent(generative_model(fail(0), fail(1)), capabilities=[ConversationLogging()]).run_sync('answer')
    assert list(caught.value.exceptions) == errors
    assert usage.incomplete


def test_concurrent_fallback_execution_ids_stay_with_their_requests(monkeypatch, tmp_path):
    """Two overlapping fallback chains retain separate event/request associations."""
    import re
    monkeypatch.chdir(tmp_path)
    async def exercise():
        def agent_for(name):
            async def primary(messages, info):
                await asyncio.sleep(0)
                raise ModelHTTPError(503, name, 'unavailable')
            async def fallback(messages, info):
                await asyncio.sleep(0)
                return ModelResponse(parts=[TextPart(name)])
            return Agent(generative_model(FunctionModel(primary, model_name=name + '-primary'),
                         FunctionModel(fallback, model_name=name + '-fallback')),
                         capabilities=[ConversationLogging()])
        results = await asyncio.gather(agent_for('left').run('answer'), agent_for('right').run('answer'))
        assert [r.output for r in results] == ['left', 'right']
    with scope(WorkerSettings(worker_environment='local')), collect_task_usage():
        asyncio.run(exercise())
    text = next(tmp_path.glob('conversation_logs/**/*.md')).read_text()
    events = text.split('### FALLBACK EXECUTION')[1:]
    assert len(events) == 2
    executions = set()
    for block in events:
        event = block.split('### ')[0]
        execution = re.search(r'Fallback execution: ([a-f0-9-]+)', event)[1]
        destination = re.search(r'To model: (\S+)', event)[1]
        executions.add(execution)
        matching = [b for b in text.split('### ') if 'Request snapshot' in b
                    and f'Fallback execution: {execution}' in b]
        assert len(matching) == 1
        assert f'Model: {destination}' in matching[0]
    assert len(executions) == 2


def test_child_run_inside_active_fallback_is_not_a_fallback(monkeypatch, tmp_path):
    """An ordinary nested agent cannot inherit its parent's fallback request label."""
    monkeypatch.chdir(tmp_path)
    async def exercise():
        child_model = FunctionModel(lambda m, i: ModelResponse(parts=[TextPart('child')]), model_name='child')
        child = Agent(generative_model(child_model, child_model), capabilities=[ConversationLogging()])
        async def primary(messages, info):
            raise ModelHTTPError(503, 'primary', 'unavailable')
        async def fallback(messages, info):
            await child.run('child')
            return ModelResponse(parts=[TextPart('ok')])
        agent = Agent(generative_model(FunctionModel(primary), FunctionModel(fallback)),
                      capabilities=[ConversationLogging()])
        assert (await agent.run('answer')).output == 'ok'
    with scope(WorkerSettings(worker_environment='local')), collect_task_usage():
        asyncio.run(exercise())
    text = next(tmp_path.glob('conversation_logs/**/*.md')).read_text()
    child_snapshot = next(b for b in text.split('### ') if 'Request snapshot' in b and 'Model: function:child' in b)
    assert 'Fallback execution: None' in child_snapshot
    assert text.count('### FALLBACK EXECUTION') == 1
