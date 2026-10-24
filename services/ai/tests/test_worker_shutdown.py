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
