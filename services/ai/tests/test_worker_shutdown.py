"""Exercise real process stop signals through the worker's queue and tracing lifecycle.

All dependencies are local fakes. Interrupted work must close its spans without publishing
a terminal failure or acknowledging the queue message, so a later worker can retry it.
"""

import asyncio
import json
import os
import signal

import pytest
from opentelemetry import trace

from tests import test_tracing
from tests.test_polling_loop import FakeResultQueue, FakeTaskQueue, build_sqs_message
from worker import main
from worker.queue_messages import AiResultMessage


@pytest.fixture
def exporters():
    yield from test_tracing.exporters.__wrapped__()


@pytest.fixture(autouse=True)
def shutdown_deadline():
    """Fail a swallowed-signal regression instead of leaving the test process hanging."""
    def expired(number, frame):
        raise SystemExit("Worker shutdown did not finish within 15 seconds")

    previous_handler = signal.signal(signal.SIGALRM, expired)
    signal.alarm(15)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)


def configure_fake_worker(monkeypatch, dependencies, task_queue, result_queue):
    """Keep the real worker entry point and polling loop, replacing external boundaries."""
    dependencies.settings.worker_concurrency = 1  # These tests exercise the main-thread loop.
    monkeypatch.setattr(main, "load_settings", lambda: dependencies.settings)
    monkeypatch.setattr(main, "configure_tracing", lambda: None)
    monkeypatch.setattr(main, "SqsQueueClient", lambda settings, name:
                        task_queue if name == settings.ai_tasks_queue_name else result_queue)
    monkeypatch.setattr(main, "S3FileStorage", lambda settings: dependencies.file_storage)
    monkeypatch.setattr(main, "build_http_client", lambda settings: dependencies.http_client)
    monkeypatch.setattr(main, "build_database_context_reader", lambda settings: None)
    monkeypatch.setattr(main, "build_database_library_reader", lambda settings: None)
    monkeypatch.setattr(main, "TaskDependencies", lambda **kwargs: dependencies)


@pytest.mark.parametrize("stop_signal", [signal.SIGTERM, signal.SIGINT])
@pytest.mark.parametrize("execution", ["sync", "async"])
def test_stop_closes_active_spans_and_keeps_message_for_retry(
    monkeypatch, task_dependencies, exporters, stop_signal, execution,
):
    """A real stop signal unwinds nested work and exports its end before returning."""
    message = build_sqs_message("interrupted", body=json.dumps({
        "ai_task_id": "b711e6ab-7237-488c-b4fa-114abe23aec2",
        "user_id": "746a504a-5d5f-4f96-8763-dd30038fa62b",
        "task_type": "parse_resume",
        "input": {},
    }))
    task_queue = FakeTaskQueue([[message]])
    result_queue = FakeResultQueue()
    configure_fake_worker(monkeypatch, task_dependencies, task_queue, result_queue)
    previous_handlers = {number: signal.getsignal(number)
                         for number in (signal.SIGTERM, signal.SIGINT)}

    async def waiting_provider():
        with trace.get_tracer(__name__).start_as_current_span(
            "waiting_provider", record_exception=False, set_status_on_exception=False,
        ):
            asyncio.get_running_loop().call_soon(os.kill, os.getpid(), stop_signal)
            await asyncio.Future()

    def interrupted_handler(task, dependencies):
        with trace.get_tracer(__name__).start_as_current_span(
            "resume_import.prepare_pii", record_exception=False, set_status_on_exception=False,
        ):
            if execution == "async":
                asyncio.run(waiting_provider())
            else:
                os.kill(os.getpid(), stop_signal)
            return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result={})

    monkeypatch.setattr(main, "handle_ai_task", interrupted_handler)
    main.run_worker()

    assert task_queue.deleted_receipts == []
    assert task_queue.delayed == []
    [started] = [json.loads(body) for body in result_queue.sent_bodies]
    assert started["status"] == "usage"
    assert started["attempt_finished"] is False
    assert started["usage_incomplete"] is True
    spans = exporters[0].get_finished_spans()
    parent = next(span for span in spans if span.name == "ai_task.parse_resume")
    stage = next(span for span in spans if span.name == "resume_import.prepare_pii")
    assert stage.parent.span_id == parent.context.span_id
    assert stage.end_time <= parent.end_time
    if execution == "async":
        provider = next(span for span in spans if span.name == "waiting_provider")
        assert provider.end_time <= stage.end_time
    assert any("WorkerShutdown" in event.attributes.get("exception.type", "")
               for event in parent.events)
    assert all(signal.getsignal(number) == handler
               for number, handler in previous_handlers.items())


def test_idle_stop_flushes_once_and_repeated_signals_do_not_interrupt_cleanup(
    monkeypatch, task_dependencies,
):
    """SIGTERM interrupts queue waiting; a second signal lets bounded flushing finish."""
    task_queue = FakeTaskQueue([])
    result_queue = FakeResultQueue()
    configure_fake_worker(monkeypatch, task_dependencies, task_queue, result_queue)
    events = []

    def waiting_receive():
        os.kill(os.getpid(), signal.SIGTERM)
        events.append("receive continued")
        return []

    def flush():
        events.append("flush started")
        os.kill(os.getpid(), signal.SIGINT)
        events.append("flush finished")

    monkeypatch.setattr(task_queue, "receive_messages", waiting_receive)
    monkeypatch.setattr(main, "flush_tracing", flush)
    main.run_worker()

    assert events == ["flush started", "flush finished"]
    assert result_queue.sent_bodies == []
    assert task_queue.deleted_receipts == []


import threading
import time
from uuid import uuid4


class BlockingTaskQueue(FakeTaskQueue):
    """Hands out one message per receive, then idles like a long poll. Thread safe."""

    def __init__(self, messages, when_idle=None):
        super().__init__([])
        self.messages = list(messages)
        self.lock = threading.Lock()
        self.when_idle = when_idle

    def receive_messages(self):
        with self.lock:
            if self.messages:
                return [self.messages.pop(0)]
        if self.when_idle:
            self.when_idle(self)
        time.sleep(0.02)
        return []


def task_message(receipt):
    return build_sqs_message(receipt, body=json.dumps({
        "ai_task_id": str(uuid4()), "user_id": str(uuid4()), "task_type": "analyze_gaps", "input": {},
    }))


def test_stop_during_helper_receive_does_not_start_a_new_task(monkeypatch, task_dependencies):
    """A helper's outstanding receive may return work after the stop signal arrives."""
    task_queue = FakeTaskQueue([])
    result_queue = FakeResultQueue()
    configure_fake_worker(monkeypatch, task_dependencies, task_queue, result_queue)
    task_dependencies.settings.worker_concurrency = 2
    helper_receiving = threading.Event()
    release_receive = threading.Event()
    started_tasks = []

    def receive_messages():
        if threading.current_thread() is threading.main_thread():
            assert helper_receiving.wait(5)
            try:
                os.kill(os.getpid(), signal.SIGTERM)
            finally:
                release_receive.set()
        helper_receiving.set()
        assert release_receive.wait(5)
        return [task_message("received-after-stop")]

    def handler(task, dependencies):
        started_tasks.append(task.ai_task_id)
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result={})

    monkeypatch.setattr(task_queue, "receive_messages", receive_messages)
    monkeypatch.setattr(main, "handle_ai_task", handler)
    main.run_worker()

    assert started_tasks == []
    assert result_queue.sent_bodies == []
    assert task_queue.deleted_receipts == []
    assert task_queue.delayed == []


def test_loops_run_tasks_at_the_same_time(monkeypatch, task_dependencies):
    """With four loops, four tasks overlap instead of waiting in line."""
    stopped = threading.Event()

    def stop_once_all_deleted(queue):
        if len(queue.deleted_receipts) == 4 and not stopped.is_set():
            stopped.set()
            os.kill(os.getpid(), signal.SIGTERM)

    task_queue = BlockingTaskQueue([task_message(f"r{n}") for n in range(4)], stop_once_all_deleted)
    configure_fake_worker(monkeypatch, task_dependencies, task_queue, FakeResultQueue())
    task_dependencies.settings.worker_concurrency = 4
    everyone_started = threading.Barrier(4, timeout=5)

    def handler(task, dependencies):
        everyone_started.wait()  # Only passes if all four tasks are running together.
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result={})

    monkeypatch.setattr(main, "handle_ai_task", handler)
    main.run_worker()

    assert sorted(task_queue.deleted_receipts) == ["r0", "r1", "r2", "r3"]


def test_stop_lets_a_helper_thread_finish_its_task(monkeypatch, task_dependencies):
    """The main loop is interrupted at once; a helper finishes, publishes and deletes."""
    task_queue = BlockingTaskQueue([task_message("first"), task_message("second")])
    result_queue = FakeResultQueue()
    configure_fake_worker(monkeypatch, task_dependencies, task_queue, result_queue)
    task_dependencies.settings.worker_concurrency = 2
    both_running = threading.Barrier(2, timeout=5)

    def handler(task, dependencies):
        both_running.wait()
        if threading.current_thread() is threading.main_thread():
            os.kill(os.getpid(), signal.SIGTERM)
        time.sleep(0.3)  # Still working when the stop arrives.
        return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result={})

    monkeypatch.setattr(main, "handle_ai_task", handler)
    main.run_worker()

    assert len(task_queue.deleted_receipts) == 1  # The helper's task; the main one was interrupted.
    statuses = [json.loads(body)["status"] for body in result_queue.sent_bodies]
    assert statuses.count("completed") == 1


def test_stop_interrupts_a_helper_task_that_outlasts_the_window(monkeypatch, task_dependencies):
    """A helper still busy after the window is interrupted; its message stays for retry."""
    task_queue = BlockingTaskQueue([task_message("first"), task_message("second")])
    result_queue = FakeResultQueue()
    configure_fake_worker(monkeypatch, task_dependencies, task_queue, result_queue)
    task_dependencies.settings.worker_concurrency = 2
    monkeypatch.setattr(main, "HELPER_JOIN_SECONDS", 0.2)
    both_running = threading.Barrier(2, timeout=5)
    interrupted = threading.Event()

    def handler(task, dependencies):
        both_running.wait()
        if threading.current_thread() is threading.main_thread():
            os.kill(os.getpid(), signal.SIGTERM)
        try:
            while True:
                time.sleep(0.01)
        except main.WorkerShutdown:
            interrupted.set()
            raise

    monkeypatch.setattr(main, "handle_ai_task", handler)
    main.run_worker()

    assert interrupted.is_set()
    assert task_queue.deleted_receipts == []
    assert [json.loads(body)["status"] for body in result_queue.sent_bodies] == ["usage", "usage"]
