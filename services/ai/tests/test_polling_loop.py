"""
Description: Tests for the worker's polling loop: delete rules and surviving queue errors.
Index:
    - FakeTaskQueue: serves scripted receive results (messages or errors) and records deletes
    - test_*: one behavior per test
"""

import json
from collections.abc import Callable
from uuid import uuid4

import pytest

from worker import main
from worker.main import poll_task_queue_once, poll_until_stopped
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.task_dependencies import TaskDependencies


class FakeTaskQueue:
    """Stands in for the ai_tasks SqsQueueClient. Each receive pops the next scripted step."""

    def __init__(self, steps: list[list[dict] | Exception]) -> None:
        """Steps are message lists to return, or exceptions to raise, in order."""
        self.steps = steps
        self.deleted_receipts: list[str] = []
        self.delayed: list[tuple[str, int]] = []

    def receive_messages(self) -> list[dict]:
        """Returns or raises the next step; nothing once the script is used up."""
        step = self.steps.pop(0) if self.steps else []
        if isinstance(step, Exception):
            raise step
        return step

    def delete_message(self, receipt_handle: str) -> None:
        """Records the deleted message's receipt handle."""
        self.deleted_receipts.append(receipt_handle)

    def delay_redelivery(self, receipt_handle: str, delay_seconds: int) -> None:
        """Records which message was kept and how long until it is redelivered."""
        self.delayed.append((receipt_handle, delay_seconds))


class FakeResultQueue:
    """Stands in for the ai_results SqsQueueClient."""

    def __init__(self) -> None:
        """Starts with no published messages."""
        self.sent_bodies: list[str] = []

    def send_message(self, message_body: str) -> None:
        """Records the published body."""
        self.sent_bodies.append(message_body)


def build_sqs_message(receipt: str, body: str | None = None, receive_count: int = 1) -> dict:
    """Builds a raw SQS message carrying a valid task body unless one is given."""
    task = {"ai_task_id": str(uuid4()), "user_id": str(uuid4()), "task_type": "analyze_gaps"}
    return {
        "Body": body or json.dumps(task),
        "ReceiptHandle": receipt,
        "Attributes": {"ApproximateReceiveCount": str(receive_count)},
    }


def stop_after(iterations: int) -> Callable[[], bool]:
    """Returns a should_stop callback that allows the given number of loop iterations."""
    calls = {"count": 0}

    def should_stop() -> bool:
        """Counts checks and reports stop once the budget is spent."""
        calls["count"] += 1
        return calls["count"] > iterations

    return should_stop


@pytest.fixture(autouse=True)
def completing_handler_without_backoff(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Completes every task and records backoff sleeps instead of waiting."""

    def handler(task: AiTaskMessage, _dependencies: TaskDependencies) -> AiResultMessage:
        """Returns a completed result."""
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result={})

    sleeps: list[float] = []
    monkeypatch.setattr(main, "handle_ai_task", handler)
    monkeypatch.setattr(main.time, "sleep", sleeps.append)
    return sleeps


def test_deletes_a_handled_task_but_not_an_invalid_one(task_dependencies: TaskDependencies) -> None:
    """Handled tasks are deleted; invalid ones stay for the dead-letter queue."""
    task_queue = FakeTaskQueue([[build_sqs_message("good")], [build_sqs_message("bad", "nope")]])

    poll_task_queue_once(task_queue, FakeResultQueue(), task_dependencies)
    poll_task_queue_once(task_queue, FakeResultQueue(), task_dependencies)

    assert task_queue.deleted_receipts == ["good"]


def test_kept_message_is_redelivered_sooner_with_a_growing_delay(
    task_dependencies: TaskDependencies,
) -> None:
    """A kept message comes back after retry_delay_seconds times its attempt number."""
    task_queue = FakeTaskQueue([[build_sqs_message("bad", "nope", receive_count=2)]])

    poll_task_queue_once(task_queue, FakeResultQueue(), task_dependencies)

    assert task_queue.delayed == [("bad", task_dependencies.settings.retry_delay_seconds * 2)]


def test_keeps_polling_after_a_queue_error(
    task_dependencies: TaskDependencies, completing_handler_without_backoff: list[float]
) -> None:
    """An SQS error is logged and retried after a pause; the next task is still handled."""
    task_queue = FakeTaskQueue([ConnectionError("SQS unreachable"), [build_sqs_message("next")]])
    result_queue = FakeResultQueue()

    poll_until_stopped(task_queue, result_queue, task_dependencies, stop_after(2))

    assert completing_handler_without_backoff == [main.POLL_ERROR_BACKOFF_SECONDS]
    assert task_queue.deleted_receipts == ["next"]
    assert len(result_queue.sent_bodies) == 2


def test_stops_when_asked(task_dependencies: TaskDependencies) -> None:
    """The loop exits as soon as should_stop() is true, without receiving."""
    task_queue = FakeTaskQueue([[build_sqs_message("unread")]])

    poll_until_stopped(task_queue, FakeResultQueue(), task_dependencies, stop_after(0))

    assert task_queue.steps != []
