"""
Description: Tests for the worker's per-message flow: parse, handle, publish, then allow delete.
Index:
    - FakeResultQueue: records published result bodies instead of calling SQS
    - test_*: one behavior per test
"""

import json
from uuid import uuid4

import pytest
from pydantic_ai.exceptions import ModelHTTPError, UsageLimitExceeded

from llm.run_limits import RUN_LIMIT_MESSAGE
from worker import main
from worker.main import process_task_message
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


class FakeResultQueue:
    """Stands in for the ai_results SqsQueueClient."""

    def __init__(self, fail_on_send: bool = False) -> None:
        """Starts with no published messages."""
        self.sent_bodies: list[str] = []
        self.fail_on_send = fail_on_send

    def send_message(self, message_body: str) -> None:
        """Records the body, or raises to simulate SQS being unreachable."""
        if self.fail_on_send:
            raise ConnectionError("SQS unreachable")
        self.sent_bodies.append(message_body)


def build_task_body(**overrides: object) -> str:
    """Builds a valid ai_tasks message body, with optional field overrides."""
    task = {
        "ai_task_id": str(uuid4()),
        "user_id": str(uuid4()),
        "task_type": "analyze_gaps",
        "input": {"job_id": "abc"},
    }
    return json.dumps(task | overrides)


@pytest.fixture
def completing_handler(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replaces the dispatcher with one that completes every task with a fixed result."""

    def handler(task: AiTaskMessage, _dependencies: TaskDependencies) -> AiResultMessage:
        """Returns a completed result echoing the input."""
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result=task.input)

    monkeypatch.setattr(main, "handle_ai_task", handler)


@pytest.mark.usefixtures("completing_handler")
def test_publishes_handler_result_and_allows_delete(task_dependencies: TaskDependencies) -> None:
    """A valid task publishes the handler's result for the same task id."""
    result_queue = FakeResultQueue()
    task_body = build_task_body()

    assert process_task_message(task_body, 1, result_queue, task_dependencies) is True

    started, published = [json.loads(body) for body in result_queue.sent_bodies]
    assert started["status"] == "usage"
    assert not started["attempt_finished"]
    assert started["usage_incomplete"]
    assert started["attempt_id"] == published["attempt_id"]
    assert published["ai_task_id"] == json.loads(task_body)["ai_task_id"]
    assert published["status"] == "completed"
    assert published["result"] == {"job_id": "abc"}


@pytest.mark.usefixtures("completing_handler")
def test_running_the_same_task_twice_publishes_the_same_result(
    task_dependencies: TaskDependencies,
) -> None:
    """Redelivered tasks are safe: Rails ignores the second result for the finished task."""
    result_queue = FakeResultQueue()
    task_body = build_task_body()

    process_task_message(task_body, 1, result_queue, task_dependencies)
    process_task_message(task_body, 1, result_queue, task_dependencies)

    first, second = [json.loads(body) for body in result_queue.sent_bodies if json.loads(body)["attempt_finished"]]
    assert first.pop("attempt_id") != second.pop("attempt_id")
    assert first == second


def test_invalid_message_is_not_deleted_and_publishes_nothing(
    task_dependencies: TaskDependencies,
) -> None:
    """Malformed tasks stay on the queue so SQS dead-letters them after 3 attempts."""
    result_queue = FakeResultQueue()

    invalid_task = build_task_body(task_type="write_poem")
    assert process_task_message(invalid_task, 1, result_queue, task_dependencies) is False
    assert process_task_message("not json", 1, result_queue, task_dependencies) is False
    assert result_queue.sent_bodies == []


def test_invalid_message_log_does_not_contain_the_message_body(
    task_dependencies: TaskDependencies, caplog: pytest.LogCaptureFixture
) -> None:
    """Task bodies carry resume text and answers, so the dead-letter log must not repeat them."""
    body = build_task_body(task_type="write_poem")
    secret = json.loads(body)["ai_task_id"]

    with caplog.at_level("ERROR"):
        assert process_task_message(body, 1, FakeResultQueue(), task_dependencies) is False

    assert "task_type" in caplog.text
    assert secret not in caplog.text
    assert "write_poem" not in caplog.text


def test_handler_error_publishes_failed_result(
    monkeypatch: pytest.MonkeyPatch, task_dependencies: TaskDependencies
) -> None:
    """A crashing handler reports a generic failure instead of leaking the exception."""

    def crashing_handler(_task: object, _dependencies: object) -> None:
        """Simulates a handler bug."""
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(main, "handle_ai_task", crashing_handler)
    result_queue = FakeResultQueue()

    assert process_task_message(build_task_body(), 1, result_queue, task_dependencies) is True

    published = json.loads(result_queue.sent_bodies[-1])
    assert published["status"] == "failed"
    assert published["error_message"] == "The AI task failed"


@pytest.mark.usefixtures("completing_handler")
def test_publish_failure_propagates_so_task_is_not_deleted(
    task_dependencies: TaskDependencies,
) -> None:
    """If the result can't be published, the task must be redelivered rather than lost."""
    with pytest.raises(ConnectionError):
        process_task_message(
            build_task_body(), 1, FakeResultQueue(fail_on_send=True), task_dependencies
        )


def test_unfinished_marker_precedes_work_and_survives_an_interrupted_execution(
    monkeypatch: pytest.MonkeyPatch, task_dependencies: TaskDependencies,
) -> None:
    """An interrupted execution leaves durable uncertainty instead of disappearing as free."""
    queue = FakeResultQueue()

    def interrupted_handler(task, dependencies):
        """Checks that accounting was published before work, then simulates worker shutdown."""
        [started] = [json.loads(body) for body in queue.sent_bodies]
        assert started["status"] == "usage"
        assert not started["attempt_finished"]
        assert started["usage_incomplete"]
        raise KeyboardInterrupt()

    monkeypatch.setattr(main, "handle_ai_task", interrupted_handler)
    with pytest.raises(KeyboardInterrupt):
        process_task_message(build_task_body(), 1, queue, task_dependencies)
    assert len(queue.sent_bodies) == 1


@pytest.fixture
def rate_limited_handler(monkeypatch: pytest.MonkeyPatch) -> None:
    """Replaces the dispatcher with one that always hits a model rate limit."""

    def handler(_task: object, _dependencies: object) -> None:
        """Simulates OpenAI answering 429 through Pydantic AI."""
        raise ModelHTTPError(status_code=429, model_name="gpt-5-mini", body="rate limited")

    monkeypatch.setattr(main, "handle_ai_task", handler)


@pytest.mark.usefixtures("rate_limited_handler")
def test_temporary_error_before_last_attempt_is_left_for_retry(
    task_dependencies: TaskDependencies,
) -> None:
    """A rate limit reports this attempt's usage and keeps the task for redelivery."""
    result_queue = FakeResultQueue()

    assert process_task_message(build_task_body(), 1, result_queue, task_dependencies) is False
    started, report = [json.loads(body) for body in result_queue.sent_bodies]
    assert not started["attempt_finished"]
    assert report["status"] == "usage"
    assert report["attempt_id"]


def test_run_limit_fails_on_the_first_attempt(
    monkeypatch: pytest.MonkeyPatch, task_dependencies: TaskDependencies
) -> None:
    """A request, tool-call, or token cap publishes a failure and deletes the message."""

    def handler(_task: object, _dependencies: object) -> None:
        """Simulates an agent run that passed its cap."""
        raise UsageLimitExceeded("request_limit of 6")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    result_queue = FakeResultQueue()

    assert process_task_message(build_task_body(), 1, result_queue, task_dependencies) is True

    published = json.loads(result_queue.sent_bodies[-1])
    assert published["status"] == "failed"
    assert published["error_message"] == RUN_LIMIT_MESSAGE


@pytest.mark.usefixtures("rate_limited_handler")
def test_temporary_error_on_last_attempt_publishes_failed(
    task_dependencies: TaskDependencies,
) -> None:
    """On the last attempt the task fails for good instead of silently dead-lettering."""
    result_queue = FakeResultQueue()
    last_attempt = task_dependencies.settings.max_task_attempts

    assert process_task_message(build_task_body(), last_attempt, result_queue, task_dependencies)

    assert json.loads(result_queue.sent_bodies[-1])["status"] == "failed"


@pytest.mark.parametrize("failure", [False, True])
@pytest.mark.parametrize("kind,fields,revision", [
    ("career_context", {"requirement": "On call", "response": "Weekly"}, {}),
    ("job", {"title": "Engineer", "requirements": ["Python"]}, {}),
    ("gap_response", {"requirement": "On call", "body": "Weekly"}, {}),
    ("interview_question", {"answer_text": "I led a team."}, {"question_revision": 1, "answer_revision": 2}),
])
def test_successful_record_checks_survive_generation_failure(monkeypatch, task_dependencies, failure, kind, fields, revision):
    import asyncio

    from screening.records import ScreenableRecord, field_fingerprint, screen_records
    from screening.screen_user_text import ScreenOutcome
    def handler(task, dependencies):
        async def allow(_):
            return ScreenOutcome(True)
        asyncio.run(screen_records([ScreenableRecord(record_type=kind, record_id="saved-record", fields=fields,
            display_title="Saved record", revision=revision)], screen=allow))
        if failure:
            raise RuntimeError("generation failed")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed")
    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    assert process_task_message(build_task_body(), 1, queue, task_dependencies)
    started, final = map(json.loads, queue.sent_bodies)
    assert not started["record_screening"]
    assert final["record_screening"] == [{"record_type": kind, "record_id": "saved-record", "revision": revision,
        "fingerprints": {name: field_fingerprint(value) for name, value in fields.items()}}]


def test_reference_notification_loads_saved_command(monkeypatch, task_dependencies):
    """Queue identities select durable commands; source text never comes from the queue."""
    from dataclasses import replace
    body = build_task_body(schema_version=1)
    envelope = json.loads(body)
    del envelope["input"]
    seen = []
    def read_command(task):
        seen.append(task)
        return task.model_copy(update={"input": {"job_id": "saved-job"}})
    dependencies = replace(task_dependencies, read_task_command=read_command)
    monkeypatch.setattr(main, "handle_ai_task", lambda task, deps: AiResultMessage(
        ai_task_id=task.ai_task_id, status="completed", result=task.input))
    queue = FakeResultQueue()
    assert process_task_message(json.dumps(envelope), 1, queue, dependencies)
    assert len(seen) == 1
    assert json.loads(queue.sent_bodies[-1])["result"] == {"job_id": "saved-job"}


@pytest.mark.parametrize("version", [2, None, True, "1", 1.0])
def test_unsupported_notification_version_is_not_executed(version, task_dependencies):
    queue = FakeResultQueue()
    body = json.loads(build_task_body())
    del body["input"]
    body["schema_version"] = version
    assert not process_task_message(json.dumps(body), 1, queue, task_dependencies)
    assert queue.sent_bodies == []


def test_versioned_notification_rejects_source_payload(task_dependencies):
    queue = FakeResultQueue()
    assert not process_task_message(build_task_body(schema_version=1), 1, queue, task_dependencies)
    assert queue.sent_bodies == []


def test_stale_or_foreign_delivery_has_no_accounting_or_execution(monkeypatch, task_dependencies):
    from dataclasses import replace
    dependencies = replace(task_dependencies, read_task_command=lambda task: None)
    monkeypatch.setattr(main, "handle_ai_task", lambda *args: pytest.fail("Must not execute"))
    monkeypatch.setattr(main, "conversation_scope", lambda *args: pytest.fail("Must not capture"))
    queue = FakeResultQueue()
    assert process_task_message(build_task_body(), 2, queue, dependencies)
    assert queue.sent_bodies == []


def test_legacy_queue_content_is_replaced_before_capture(monkeypatch, task_dependencies):
    from contextlib import nullcontext
    from dataclasses import replace
    def stored_command(task):
        return task.model_copy(update={"input": {"job_id": "durable"}})
    dependencies = replace(task_dependencies, read_task_command=stored_command)
    captured = []
    def capture(task, *args):
        captured.append(task.input)
        return nullcontext()
    monkeypatch.setattr(main, "conversation_scope", capture)
    monkeypatch.setattr(main, "handle_ai_task", lambda task, deps: AiResultMessage(
        ai_task_id=task.ai_task_id, status="completed", result=task.input))
    queue = FakeResultQueue()
    assert process_task_message(build_task_body(input={"secret": "untrusted"}), 1, queue, dependencies)
    assert captured == [{"job_id": "durable"}]
    assert "untrusted" not in "".join(queue.sent_bodies)


def test_command_database_outage_keeps_delivery_without_usage(task_dependencies):
    from dataclasses import replace

    import psycopg
    def unavailable(task):
        raise psycopg.OperationalError("unavailable")
    queue = FakeResultQueue()
    dependencies = replace(task_dependencies, read_task_command=unavailable)
    with pytest.raises(psycopg.OperationalError):
        process_task_message(build_task_body(), 1, queue, dependencies)
    assert queue.sent_bodies == []



def test_invalid_saved_command_does_not_log_source_text(task_dependencies, caplog):
    from dataclasses import replace
    def corrupt_command(task):
        return AiTaskMessage.model_validate({
            "ai_task_id": task.ai_task_id, "user_id": task.user_id,
            "task_type": task.task_type, "input": "private-corrupt-source"})
    dependencies = replace(task_dependencies, read_task_command=corrupt_command)
    queue = FakeResultQueue()
    assert not process_task_message(build_task_body(), 1, queue, dependencies)
    assert queue.sent_bodies == []
    assert "private-corrupt-source" not in caplog.text
    assert "Invalid durable task command" in caplog.text
