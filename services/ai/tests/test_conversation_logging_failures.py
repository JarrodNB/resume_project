"""Check visible failure events through real agent validation and provider calls.

Providers are synthetic; task accounting and local transcript capture stay active.
"""
from uuid import uuid4

import pytest
from pydantic_ai import Agent, ModelRetry
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse, TextPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.usage import RequestUsage

from conversation_logging import conversation_scope
from llm.generative_model import generative_model
from llm.usage import collect_task_usage
from tests.test_process_task_message import build_task_body
from worker.queue_messages import AiTaskMessage
from worker.settings import WorkerSettings


@pytest.mark.parametrize("recover", [True, False])
def test_validation_failure_and_exhaustion(monkeypatch, tmp_path, recover):
    """Every rejected response is visible, including the final rejection without a request."""
    monkeypatch.chdir(tmp_path)
    calls = 0

    def respond(messages, info):
        nonlocal calls
        calls += 1
        value = 42 if recover and calls == 2 else "wrong integer"
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"response": value})],
                             model_name="openai:gpt-5-mini", usage=RequestUsage(input_tokens=10))

    from conversation_logging import ConversationLogging
    task = AiTaskMessage.model_validate_json(build_task_body())
    model = FunctionModel(respond, model_name="openai:gpt-5-mini")
    with conversation_scope(task, WorkerSettings(worker_environment="local"), uuid4(), 1), collect_task_usage() as usage:
        agent = Agent(generative_model(model, model), output_type=int, retries=1,
                      capabilities=[ConversationLogging()])
        if recover:
            assert agent.run_sync("answer").output == 42
        else:
            with pytest.raises(UnexpectedModelBehavior):
                agent.run_sync("answer")
    text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
    assert text.count("### VALIDATION FAILURE / RETRY") == 1
    assert text.count("### VALIDATION EXHAUSTED") == (0 if recover else 1)
    assert "wrong integer" in text and "int_parsing" in text
    assert "Run:" in text and "Model: openai:gpt-5-mini" in text
    assert calls == 2
    assert sum(entry.input_tokens for entry in usage.entries) == 20


@pytest.mark.parametrize("provider_validation_error", [False, True])
def test_provider_failure_has_prominent_identity_without_payload(monkeypatch, tmp_path, provider_validation_error):
    """The original error escapes, while the transcript omits its arbitrary message."""
    monkeypatch.chdir(tmp_path)
    error = ValueError("private provider payload")
    if provider_validation_error:
        from pydantic import TypeAdapter, ValidationError
        try:
            TypeAdapter(int).validate_python("private provider payload")
        except ValidationError as cause:
            error = UnexpectedModelBehavior("private provider payload")
            error.__cause__ = cause

    def fail(messages, info):
        raise error

    task = AiTaskMessage.model_validate_json(build_task_body())
    model = FunctionModel(fail, model_name="failed-model")
    with (
        conversation_scope(task, WorkerSettings(worker_environment="local"), uuid4(), 1),
        collect_task_usage(), pytest.raises(type(error)) as caught,
    ):
        from conversation_logging import ConversationLogging
        Agent(generative_model(model, model), capabilities=[ConversationLogging()]).run_sync("answer")
    assert caught.value is error
    text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
    assert "### PROVIDER FAILURE" in text
    assert "Model: function:failed-model" in text and "Request" in text
    assert "private provider payload" not in text
    assert "### VALIDATION" not in text


def test_repeated_history_is_feedback_not_new_failure(monkeypatch, tmp_path):
    """Several snapshots and a resumed run must not announce old feedback again."""
    from conversation_logging import ConversationLogging
    monkeypatch.chdir(tmp_path)
    calls = 0

    def respond(messages, info):
        nonlocal calls
        calls += 1
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
                                                {"response": "bad" if calls < 3 else 42})])

    task = AiTaskMessage.model_validate_json(build_task_body())
    model = FunctionModel(respond, model_name="history-model")
    with conversation_scope(task, WorkerSettings(worker_environment="local"), uuid4(), 1), collect_task_usage():
        agent = Agent(generative_model(model, model), output_type=int, retries=2,
                      capabilities=[ConversationLogging()])
        result = agent.run_sync("answer")
        assert agent.run_sync("again", message_history=result.all_messages()).output == 42
    text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
    assert text.count("### VALIDATION FAILURE / RETRY") == 2
    assert text.count("#### Validation retry") > 2  # full histories deliberately repeat
    assert "### VALIDATION EXHAUSTED" not in text


@pytest.mark.parametrize("broken_render", [False, True])
def test_validator_feedback_masked_and_logging_nonfatal(monkeypatch, tmp_path, broken_render):
    """Custom validation exhaustion masks restored contact and survives render errors."""
    import conversation_logging
    from conversation_logging import ConversationLogging
    from privacy.contact_mask import contact_scope, install_contact_hook
    from privacy.known_contact import KnownContact
    monkeypatch.chdir(tmp_path)
    task = AiTaskMessage.model_validate_json(build_task_body())
    error = ModelRetry("Do not use Synthetic Person")
    model = FunctionModel(lambda messages, info: ModelResponse(parts=[TextPart("ok")]), model_name="custom-validator")
    with conversation_scope(task, WorkerSettings(worker_environment="local"), uuid4(), 1), collect_task_usage():
        agent = Agent(generative_model(model, model), retries=0, capabilities=[ConversationLogging()])
        install_contact_hook(agent)

        @agent.output_validator
        def reject(output):
            raise error

        if broken_render:
            def fail_render(*args):
                raise OSError("synthetic rendering failure")
            monkeypatch.setattr(conversation_logging, "render_messages", fail_render)
        with (
            contact_scope(KnownContact.from_values(names=["Synthetic Person"])),
            pytest.raises(UnexpectedModelBehavior) as caught,
        ):
            agent.run_sync("answer")
        assert caught.value.__cause__.tool_retry.content == error.message
    text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
    assert "Synthetic Person" not in text
    if not broken_render:
        assert "### VALIDATION EXHAUSTED" in text
        assert "Do not use «name»" in text


@pytest.mark.parametrize("nested", [False, True])
def test_parallel_and_nested_validation_identity(monkeypatch, tmp_path, nested):
    """Independent runs retain their own request identity and restore their parent."""
    import asyncio
    import re

    from conversation_logging import ConversationLogging
    monkeypatch.chdir(tmp_path)
    task = AiTaskMessage.model_validate_json(build_task_body())

    async def run():
        calls = {}

        def agent_for(name):
            async def respond(messages, info):
                calls[name] = calls.get(name, 0) + 1
                if nested and name == "parent" and calls[name] == 1:
                    assert (await agent_for("child").run("child")).output == 42
                await asyncio.sleep(0)
                value = "bad" if calls[name] == 1 else 42
                return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, {"response": value})])
            model = FunctionModel(respond, model_name=name)
            return Agent(generative_model(model, model), output_type=int, capabilities=[ConversationLogging()])

        if nested:
            assert (await agent_for("parent").run("parent")).output == 42
        else:
            results = await asyncio.gather(agent_for("left").run("left"), agent_for("right").run("right"))
            assert [result.output for result in results] == [42, 42]

    with conversation_scope(task, WorkerSettings(worker_environment="local"), uuid4(), 1), collect_task_usage():
        asyncio.run(run())
    text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
    blocks = text.split("### VALIDATION FAILURE / RETRY")[1:]
    assert len(blocks) == 2
    for block in blocks:
        event = block.split("### ")[0]
        request = re.search(r"Request: ([\w-]+)", event)[1]
        model = re.search(r"Model: (\S+)", event)[1]
        assert f"/ Request {request} — Request snapshot" in text
        snapshot = text.split(f"/ Request {request} — Request snapshot")[1].split("### ")[0]
        assert f"Model: {model}" in snapshot


def test_observation_setup_failure_keeps_success_and_costs(monkeypatch, tmp_path):
    """A failed local observer still permits the real run and request accounting."""
    import conversation_logging
    from conversation_logging import ConversationLogging
    monkeypatch.chdir(tmp_path)

    def fail_setup(*args, **kwargs):
        raise OSError("synthetic observation setup failure")

    monkeypatch.setattr(conversation_logging, "_RunObservation", fail_setup)
    model = FunctionModel(lambda messages, info: ModelResponse(parts=[TextPart("ok")],
                          model_name="openai:gpt-5-mini", usage=RequestUsage(input_tokens=10)))
    task = AiTaskMessage.model_validate_json(build_task_body())
    with conversation_scope(task, WorkerSettings(worker_environment="local"), uuid4(), 1), collect_task_usage() as usage:
        agent = Agent(generative_model(model, model), capabilities=[ConversationLogging()])
        assert agent.run_sync("answer").output == "ok"
    assert sum(entry.input_tokens for entry in usage.entries) == 10
