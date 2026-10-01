"""
Description: Tests for the worker's per-message flow: parse, handle, publish, then allow delete.
Index:
    - FakeResultQueue: records published result bodies instead of calling SQS
    - test_*: one behavior per test
"""

import json
from uuid import uuid4

import pytest

from worker import main
from worker.main import process_task_message


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


def test_publishes_completed_echo_result_and_allows_delete() -> None:
    """A valid task publishes a completed result for the same task id."""
    result_queue = FakeResultQueue()
    task_body = build_task_body()

    assert process_task_message(task_body, result_queue) is True

    [published] = [json.loads(body) for body in result_queue.sent_bodies]
    assert published["ai_task_id"] == json.loads(task_body)["ai_task_id"]
    assert published["status"] == "completed"
    assert published["result"] == {"echo": {"job_id": "abc"}, "task_type": "analyze_gaps"}


def test_running_the_same_task_twice_publishes_the_same_result() -> None:
    """Redelivered tasks are safe: Rails ignores the second result for the finished task."""
    result_queue = FakeResultQueue()
    task_body = build_task_body()

    process_task_message(task_body, result_queue)
    process_task_message(task_body, result_queue)

    first, second = result_queue.sent_bodies
    assert json.loads(first) == json.loads(second)


def test_invalid_message_is_not_deleted_and_publishes_nothing() -> None:
    """Malformed tasks stay on the queue so SQS dead-letters them after 3 attempts."""
    result_queue = FakeResultQueue()

    assert process_task_message(build_task_body(task_type="write_poem"), result_queue) is False
    assert process_task_message("not json", result_queue) is False
    assert result_queue.sent_bodies == []


def test_handler_error_publishes_failed_result(monkeypatch: pytest.MonkeyPatch) -> None:
    """A crashing handler reports a generic failure instead of leaking the exception."""

    def crashing_handler(_task: object) -> None:
        """Simulates a handler bug."""
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(main, "handle_ai_task", crashing_handler)
    result_queue = FakeResultQueue()

    assert process_task_message(build_task_body(), result_queue) is True

    published = json.loads(result_queue.sent_bodies[0])
    assert published["status"] == "failed"
    assert published["error_message"] == "The AI task failed"


def test_publish_failure_propagates_so_task_is_not_deleted() -> None:
    """If the result can't be published, the task must be redelivered rather than lost."""
    with pytest.raises(ConnectionError):
        process_task_message(build_task_body(), FakeResultQueue(fail_on_send=True))
