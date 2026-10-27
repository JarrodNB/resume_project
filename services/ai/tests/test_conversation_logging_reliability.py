"""Check local transcripts across retries, failures, and concurrent writes.

Use fake providers and queues to verify logging preserves original task
behavior even when rendering or file writes fail.
"""
import json
import multiprocessing
import re
from uuid import uuid4

import pytest
from pydantic_ai import Agent
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel

from conversation_logging import Transcript
from llm.generative_model import generative_model
from tests.test_process_task_message import FakeResultQueue, build_task_body
from worker import main
from worker.queue_messages import AiResultMessage


def test_nested_calls_fallback_and_generation_redelivery(monkeypatch, task_dependencies, tmp_path):
    """Retains actual nested calls, fallback errors, and successive task generations."""
    monkeypatch.chdir(tmp_path)
    task_dependencies.settings.worker_environment = "local"

    async def screen(messages, info):
        """Returns a synthetic nested screening result."""
        return ModelResponse(parts=[TextPart("screen passed")])

    async def fail(messages, info):
        """Runs nested screening before a primary provider failure."""
        model = FunctionModel(screen, model_name="synthetic-screen")
        await Agent(generative_model(model, model)).run("nested screen prompt")
        raise ModelHTTPError(503, "synthetic-primary", "unavailable")

    async def recover(messages, info):
        """Provides a fallback answer."""
        return ModelResponse(parts=[TextPart("fallback answer")])

    def handler(task, dependencies):
        """Runs a real fallback chain through the normal accounting seam."""
        primary = FunctionModel(fail, model_name="synthetic-primary")
        fallback = FunctionModel(recover, model_name="synthetic-fallback")
        Agent(generative_model(primary, fallback)).run_sync("generation prompt")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="needs_user_input")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    job, task_id, user = str(uuid4()), str(uuid4()), str(uuid4())
    for count in (1, 2):
        body = build_task_body(ai_task_id=task_id, user_id=user, task_type="tailor_resume",
                               input={"job_id": job, "generation": count})
        assert main.process_task_message(body, count, FakeResultQueue(), task_dependencies)
    text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
    for value in ("synthetic-primary", "synthetic-fallback", "synthetic-screen",
                  "nested screen prompt", "fallback answer", "Provider error: ModelHTTPError",
                  "Generation: 1", "Generation: 2", "Receive count: 2"):
        assert value in text
    assert text.count("Outcome: needs_user_input result published") == 2
    files = list(tmp_path.glob("conversation_logs/**/*.md"))
    assert [path.name for path in files] == [f"task-{task_id}.md"]
    assert "## INITIAL ATTEMPT — delivery 1" in text
    assert "## RETRY / REDELIVERY — delivery 2" in text
    attempts = re.findall(r"^Attempt: ([0-9a-f-]+)$", text, re.MULTILINE)
    assert len(attempts) == 2 and len(set(attempts)) == 2


@pytest.mark.parametrize("broken", ["none", "disk", "format"])
def test_retry_and_original_publication_errors_survive_logging(monkeypatch, task_dependencies, tmp_path, broken):
    """Logging errors preserve retry, usage messages and the original publication error."""
    import conversation_logging
    monkeypatch.chdir(tmp_path)
    task_dependencies.settings.worker_environment = "local"
    if broken == "disk":
        (tmp_path / "conversation_logs").write_text("blocked")
    if broken == "format":
        def broken_render(*args):
            """Simulates unsupported message formatting."""
            raise ValueError("renderer failure")
        monkeypatch.setattr(conversation_logging, "render_messages", broken_render)

    def fail(messages, info):
        """Raises a temporary provider error."""
        raise ModelHTTPError(503, "synthetic", "unavailable")

    def handler(task, dependencies):
        """Uses the actual provider adapter."""
        model = FunctionModel(fail, model_name="synthetic")
        Agent(generative_model(model, model)).run_sync("request")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    body = build_task_body()
    assert main.process_task_message(body, 1, queue, task_dependencies) is False
    messages = [json.loads(item) for item in queue.sent_bodies]
    assert [item["status"] for item in messages] == ["usage", "usage"]
    assert messages[-1]["attempt_finished"] is True
    assert messages[-1]["usage_incomplete"] is True

    original = ConnectionError("original publication failure")
    class BrokenQueue(FakeResultQueue):
        """Allows initial usage then fails actual result delivery."""
        def send_message(self, body):
            """Preserves a recognizable original error."""
            if self.sent_bodies:
                raise original
            super().send_message(body)
    with pytest.raises(ConnectionError) as caught:
        main.process_task_message(body, task_dependencies.settings.max_task_attempts,
                                  BrokenQueue(), task_dependencies)
    assert caught.value is original
    if broken == "none":
        text = next(tmp_path.glob("conversation_logs/**/*.md")).read_text()
        assert "### RETRY PENDING — Attempt " in text
        assert "### PUBLICATION FAILURE — Attempt " in text
        assert "Outcome: retry pending; usage published" in text
        assert "failed result publication failed (ConnectionError)" in text


def _append_blocks(path, index):
    """Writes large identifiable blocks from a separate worker process."""
    transcript = Transcript(path, uuid4())
    for iteration in range(12):
        transcript.append(f"BEGIN {index}-{iteration}\n" + str(index) * 200000 + f"\nEND {index}-{iteration}")


def test_process_appends_are_intact(tmp_path):
    """Independent worker processes cannot interleave Markdown blocks."""
    path = tmp_path / "shared.md"
    context = multiprocessing.get_context("spawn")
    processes = [context.Process(target=_append_blocks, args=(path, index)) for index in range(4)]
    for process in processes:
        process.start()
    for process in processes:
        process.join(30)
        assert process.exitcode == 0
    text = path.read_text()
    blocks = text.strip().split("\n\n")
    assert len(blocks) == 48
    for index in range(4):
        for iteration in range(12):
            assert f"BEGIN {index}-{iteration}\n" + str(index) * 200000 + f"\nEND {index}-{iteration}" in blocks


@pytest.mark.parametrize("broken", ["disk", "format"])
def test_logging_failure_preserves_provider_exception(monkeypatch, tmp_path, broken):
    """The actual adapter rethrows the original provider object despite logging failures."""
    import conversation_logging
    from llm.usage import collect_task_usage
    from worker.queue_messages import AiTaskMessage
    from worker.settings import WorkerSettings
    monkeypatch.chdir(tmp_path)
    if broken == "disk":
        (tmp_path / "conversation_logs").write_text("blocked")
    else:
        def fail_render(*args):
            """Simulates an unsupported message."""
            raise ValueError("render failure")
        monkeypatch.setattr(conversation_logging, "render_messages", fail_render)
    original = ValueError("original provider failure")
    def fail(messages, info):
        """Raises an identifiable provider exception."""
        raise original
    task = AiTaskMessage.model_validate_json(build_task_body())
    with (
        conversation_logging.conversation_scope(task, WorkerSettings(worker_environment="local"), uuid4(), 1),
        collect_task_usage() as usage,
    ):
        model = FunctionModel(fail, model_name="synthetic")
        with pytest.raises(ValueError) as caught:
            Agent(generative_model(model, model)).run_sync("request")
        assert caught.value is original
        assert usage.incomplete is True
