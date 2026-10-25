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

from worker import main
from worker.main import process_task_message
from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.run_limits import RUN_LIMIT_MESSAGE
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
def test_successful_library_checks_survive_generation_failure(monkeypatch, task_dependencies, failure):
    from schemas.gap_analysis_context import CareerLibrary, LibraryFact
    from screening.library_fields import screen_library_fields

    def handler(task, dependencies):
        screen_library_fields(CareerLibrary(facts=[LibraryFact(
            id="fact", requirement="On call", response="Weekly")]), lambda _: True)
        if failure:
            raise RuntimeError("generation failed")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    assert process_task_message(build_task_body(), 1, queue, task_dependencies)
    started, final = map(json.loads, queue.sent_bodies)
    assert not started["library_screening"]
    assert final["library_screening"] == [{"record_type": "library_fact", "record_id": "fact",
                                           "fields": ["requirement", "response"]}]


@pytest.mark.parametrize("failure", [False, True])
def test_successful_job_checks_survive_generation_failure(monkeypatch, task_dependencies, failure):
    from schemas.gap_analysis_context import JobToAnalyze
    from screening.job_fields import field_fingerprint, screen_job_fields

    def handler(task, dependencies):
        screen_job_fields(JobToAnalyze(id="job", title="Engineer", requirements=["Python"]),
            lambda _: True, approved_sources=["source"])
        if failure:
            raise RuntimeError("generation failed")
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed")

    monkeypatch.setattr(main, "handle_ai_task", handler)
    queue = FakeResultQueue()
    assert process_task_message(build_task_body(), 1, queue, task_dependencies)
    started, final = map(json.loads, queue.sent_bodies)
    assert not started["job_screening"]
    assert final["job_screening"] == [{"job_id": "job", "fields": {
        "title": field_fingerprint("Engineer"), "requirements": field_fingerprint(["Python"])}}]
