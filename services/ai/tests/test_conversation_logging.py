"""Check readable local transcripts through real task and model interfaces.

Verify separate task files, local gates, masked exchanges and nonfatal writes
without sending requests to external providers.
"""
from dataclasses import replace
from uuid import uuid4

import pytest
from pydantic_ai import Agent
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel

from conversation_logging import conversation_scope
from tests.test_process_task_message import FakeResultQueue, build_task_body
from worker import main
from worker.generative_model import generative_model
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.settings import WorkerSettings


def test_local_task_writes_exchange(monkeypatch, task_dependencies, tmp_path):
    """A successful task retains its full model exchange in a host-readable file."""
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("WORKER_ENVIRONMENT", "local")
    monkeypatch.setenv("CONVERSATION_LOGGING_ENABLED", "true")
    from worker.settings import load_settings
    task_dependencies = replace(task_dependencies, settings=load_settings())

    def respond(messages, info):
        """Returns deterministic output without provider traffic."""
        return ModelResponse(parts=[TextPart("synthetic reply")])

    def handler(task, dependencies):
        """Uses the existing request adapter through normal model resolution."""
        model = FunctionModel(respond, model_name="synthetic-model")
        Agent(generative_model(model, model), system_prompt="system instructions",
              instructions="additional instructions").run_sync("synthetic question")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    assert main.process_task_message(build_task_body(), 1, FakeResultQueue(), task_dependencies)
    files = list(tmp_path.glob("conversation_logs/**/*.md"))
    assert len(files) == 1
    text = files[0].read_text()
    for expected in ("system instructions", "synthetic question", "synthetic reply", "synthetic-model",
                     "Request snapshot", "Attempt", "analyze_gaps", "additional instructions"):
        assert expected in text
    for omitted in ("Model request parameters", '"function_tools"', '"output_tools"', '"output_object"'):
        assert omitted not in text


@pytest.mark.parametrize("environment,enabled", [("", True), ("production", True), ("local", False)])
def test_disabled_logging_creates_nothing(monkeypatch, tmp_path, environment, enabled):
    """Only explicit local mode with opt-in default permits filesystem artifacts."""
    monkeypatch.chdir(tmp_path)
    settings = WorkerSettings(worker_environment=environment, conversation_logging_enabled=enabled)
    task = AiTaskMessage.model_validate_json(build_task_body())
    with conversation_scope(task, settings, uuid4(), 1):
        pass
    assert not (tmp_path / "conversation_logs").exists()


def test_each_task_has_its_own_file_and_preserves_legacy_logs(monkeypatch, tmp_path):
    """Separate tasks stay separate even with the same type, job or question set."""
    monkeypatch.chdir(tmp_path)
    settings = WorkerSettings(worker_environment="local")
    user, other_user, job, question_set = (uuid4() for _ in range(4))
    directory = tmp_path / "conversation_logs" / str(user)
    directory.mkdir(parents=True)
    legacy = [directory / f"job-{job}.md", directory / f"question_set-{question_set}.md"]
    for path in legacy:
        path.write_text("historical transcript")
    tasks = [
        AiTaskMessage(ai_task_id=uuid4(), user_id=owner, task_type=kind,
                      input={"job_id": str(job), "question_set_id": str(question_set)})
        for owner in (user, other_user)
        for kind in ("analyze_gaps", "analyze_gaps", "tailor_resume", "generate_interview_questions",
                     "regenerate_interview_question", "review_interview_answer", "parse_resume",
                     "parse_job_posting", "scrape_job")
    ]
    for task in tasks:
        with conversation_scope(task, settings, uuid4(), 1):
            pass
    assert len(list(tmp_path.glob("conversation_logs/**/*.md"))) == len(tasks) + len(legacy)
    for task in tasks:
        text = (tmp_path / "conversation_logs" / str(task.user_id) / f"task-{task.ai_task_id}.md").read_text()
        assert f"Task: {task.task_type} {task.ai_task_id}" in text
    assert all(path.read_text() == "historical transcript" for path in legacy)


def test_synthetic_tool_messages_are_readable():
    """Function tools, output tools and retries remain distinct with formatted arguments."""
    from pydantic_ai.messages import ModelRequest, RetryPromptPart, ToolCallPart, ToolReturnPart
    from pydantic_ai.models import ModelRequestParameters
    from pydantic_ai.tools import ToolDefinition

    from conversation_logging.render import render_messages
    parameters = ModelRequestParameters(output_tools=[ToolDefinition(name="final_result")])
    messages = [ModelResponse(parts=[ToolCallPart("lookup", '{"query":"skills"}', tool_call_id="call-1"),
                                    ToolCallPart("final_result", {"answer": 42}, tool_call_id="call-2")]),
                ModelRequest(parts=[ToolReturnPart("lookup", {"items": ["Python"]}, tool_call_id="call-1"),
                                    RetryPromptPart("Use an integer", tool_name="final_result", tool_call_id="call-2")])]
    text = render_messages(messages, parameters)
    for value in ("Function tool call", "Structured output tool call", "Function tool result", "Validation retry",
                  '"query": "skills"', "call-1", "call-2", "Use an integer"):
        assert value in text


@pytest.mark.parametrize("broken_directory", [False, True])
def test_masked_exchange_and_nonfatal_write_failure(monkeypatch, task_dependencies, tmp_path, broken_directory):
    """Capture sits after outbound masking and before restoration; disk errors leave results intact."""
    import json

    from worker import contact_mask
    from worker.contact_mask import contact_scope, install_contact_hook
    from worker.known_contact import KnownContact
    monkeypatch.chdir(tmp_path)
    # The production registry retains numeric IDs; keep synthetic agent IDs test-local.
    monkeypatch.setattr(contact_mask, "_installed", set())
    task_dependencies.settings.worker_environment = "local"
    task_dependencies.settings.conversation_logging_enabled = True
    if broken_directory:
        (tmp_path / "conversation_logs").write_text("not a directory")

    def respond(messages, info):
        """Checks the provider receives placeholders and emits those same placeholders."""
        assert messages[-1].parts[0].content == "Hello «name»"
        return ModelResponse(parts=[TextPart("Reply for «name»")])

    def handler(task, dependencies):
        """Exercises production contact hooks around the real request adapter."""
        model = FunctionModel(respond, model_name="synthetic-model")
        agent = Agent(generative_model(model, model))
        install_contact_hook(agent)
        with contact_scope(KnownContact.from_values(names=["Synthetic Person"])):
            output = agent.run_sync("Hello Synthetic Person").output
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result={"output": output})

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    assert main.process_task_message(build_task_body(), 1, queue, task_dependencies)
    result = json.loads(queue.sent_bodies[-1])
    assert result["status"] == "completed"
    assert result["result"]["output"] == "Reply for Synthetic Person"
    if not broken_directory:
        text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
        assert "Hello «name»" in text and "Reply for «name»" in text
        assert "Synthetic Person" not in text

def test_provider_failure_retains_request_and_truthful_outcome(monkeypatch, task_dependencies, tmp_path):
    """Provider failures retain requests and identify unavailable responses."""
    monkeypatch.chdir(tmp_path)
    task_dependencies.settings.worker_environment = "local"
    def fail(messages, info):
        """Fails at the provider seam."""
        raise ValueError("synthetic provider failure")
    def handler(task, dependencies):
        """Runs the production request adapter."""
        model = FunctionModel(fail, model_name="failing-model")
        Agent(generative_model(model, model)).run_sync("retained request")
    monkeypatch.setattr(main, "handle_ai_task", handler)
    assert main.process_task_message(build_task_body(), 1, FakeResultQueue(), task_dependencies)
    text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
    assert "retained request" in text
    assert "Provider error: ValueError" in text
    assert "Partial response unavailable" in text
    assert "Outcome: failed result published" in text
