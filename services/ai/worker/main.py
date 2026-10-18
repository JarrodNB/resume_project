"""Run queued AI tasks and publish their outcomes before deleting task messages.

Each delivery gets fresh execution coverage and independent usage accounting. Successful
saved-source checks are reported even after failures or retries, in bounded queue packets;
Rails owns their persistence and all domain writes.
"""

import logging
import signal
import time
from collections.abc import Callable
from contextlib import ExitStack

from pydantic import ValidationError
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai_harness import InputBlocked

from conversation_logging import conversation_scope, publish_result
from database.career_library_reader import (
    build_database_context_reader,
    build_database_library_reader,
)
from database.screening_decision_reader import build_database_screening_reader
from screening.guardrail_usage import collect_guardrail_usage
from screening.session import ScreeningSession, screening_session
from worker.contact_mask import using_known_contact
from worker.queue_messages import AiResultMessage, AiTaskMessage, ModelUsage
from worker.retryable_errors import is_retryable_error
from worker.run_limits import RUN_LIMIT_MESSAGE
from worker.s3_file_storage import S3FileStorage
from worker.settings import load_settings
from worker.sqs_queue_client import SqsQueueClient
from worker.task_dependencies import TaskDependencies, build_http_client
from worker.task_handlers import handle_ai_task
from worker.task_usage import TaskUsage, collect_task_usage
from worker.tracing import configure_tracing, trace_ai_task

logger = logging.getLogger(__name__)

POLL_ERROR_BACKOFF_SECONDS = 5


def process_task_message(
    message_body: str,
    receive_count: int,
    result_queue: SqsQueueClient,
    dependencies: TaskDependencies,
) -> bool:
    """Handles one raw task message and publishes its result.

    Returns True once a final result is published, so the task message can be deleted. Invalid
    messages publish nothing and stay for the dead-letter queue. A temporary failure before
    the last attempt publishes usage only and returns False so SQS redelivers the task.
    Every valid execution first publishes an unknown-cost marker. A run cap fails
    immediately, with no partial result and no retry. Other handler errors, and temporary ones
    on the last attempt, publish a "failed" result. If publishing itself fails, the error
    propagates and the task is redelivered.
    """
    try:
        task = AiTaskMessage.model_validate_json(message_body)
    except ValidationError:
        logger.exception(
            "Invalid task message, leaving it for the dead-letter queue: %s", message_body
        )
        return False

    guardrail_usage: list[ModelUsage] = []
    task_usage = TaskUsage()
    with conversation_scope(task, dependencies.settings, task_usage.attempt_id, receive_count):
        return _execute_task(task, receive_count, result_queue, dependencies, task_usage, guardrail_usage)


def _execute_task(task, receive_count, result_queue, dependencies, task_usage, guardrail_usage):
    """Runs the existing accounting and delivery lifecycle inside transcript capture."""
    with ExitStack() as privacy_stack:
        return _execute_with_privacy(
            task, receive_count, result_queue, dependencies, task_usage, guardrail_usage, privacy_stack
        )


def _execute_with_privacy(task, receive_count, result_queue, dependencies, task_usage,
                          guardrail_usage, privacy_stack):
    """Retain privacy through exception logging, publication, and parent span completion."""
    _publish_usage(task, task_usage, result_queue, finished=False)
    screening_state = None
    reader = dependencies.read_screening_successes
    lookup = None if reader is None else lambda candidates: reader(task.user_id, candidates)
    try:
        privacy_stack.enter_context(using_known_contact(task))
        with (
            collect_task_usage(task_usage), collect_guardrail_usage(guardrail_usage), trace_ai_task(task),
            screening_session(dependencies.settings.llm_run_timeout_seconds, lookup_successes=lookup) as screening_state,
        ):
            result = handle_ai_task(task, dependencies)
    except InputBlocked as error:
        result = AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message=str(error),
        )
    except UsageLimitExceeded:
        logger.exception("Task %s hit a run limit on attempt %d", task.ai_task_id, receive_count)
        result = AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message=RUN_LIMIT_MESSAGE
        )
    except Exception as error:
        if is_retryable_error(error) and receive_count < dependencies.settings.max_task_attempts:
            logger.warning(
                "Task %s hit a temporary error on attempt %d, leaving it for a retry",
                task.ai_task_id,
                receive_count,
                exc_info=True,
            )
            successes = _publish_screening_overflow(task, task_usage, result_queue, screening_state)
            _publish_usage(task, task_usage, result_queue, screening_successes=successes)
            return False
        logger.exception("Task %s failed on attempt %d", task.ai_task_id, receive_count)
        result = AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message="The AI task failed"
        )

    result.usage = task_usage.entries or [*result.usage, *guardrail_usage]
    result.attempt_id = task_usage.attempt_id
    result.usage_incomplete = task_usage.incomplete
    result.screening_successes = _publish_screening_overflow(
        task, task_usage, result_queue, screening_state, result_bytes=len(result.model_dump_json().encode()),
    )
    publish_result(result_queue, result)
    logger.info("Published %s result for task %s", result.status, task.ai_task_id)
    return True


def _publish_usage(task, usage, queue, *, finished=True, screening_successes=(), metadata_only=False):
    """Persists an unfinished marker or retry charges without changing task status."""
    publish_result(queue, AiResultMessage(
        ai_task_id=task.ai_task_id, status="usage", attempt_id=usage.attempt_id,
        usage=[] if metadata_only else usage.entries, usage_incomplete=usage.incomplete or not finished,
        attempt_finished=finished, screening_successes=list(screening_successes),
    ))


def _publish_screening_overflow(task, usage, queue, session: ScreeningSession | None, *, result_bytes=0):
    """Send bounded metadata without losing checks or prematurely completing accounting."""
    successes = list(session.successes.values()) if session is not None else []
    if not result_bytes:
        result_bytes = 1000 + sum(len(entry.model_dump_json().encode()) + 1 for entry in usage.entries)
    while successes and (len(successes) > 1000 or result_bytes + sum(
        len(success.model_dump_json().encode()) + 1 for success in successes
    ) > 240_000):
        _publish_usage(task, usage, queue, finished=False, screening_successes=successes[:1000], metadata_only=True)
        successes = successes[1000:]
    return successes


def poll_task_queue_once(
    task_queue: SqsQueueClient, result_queue: SqsQueueClient, dependencies: TaskDependencies
) -> None:
    """Receives at most one task message, handles it, and deletes it once its result is out.
    A kept message is redelivered after a delay that grows with each attempt."""
    for message in task_queue.receive_messages():
        receive_count = int(message.get("Attributes", {}).get("ApproximateReceiveCount", 1))
        if process_task_message(message["Body"], receive_count, result_queue, dependencies):
            task_queue.delete_message(message["ReceiptHandle"])
        else:
            delay_seconds = dependencies.settings.retry_delay_seconds * receive_count
            task_queue.delay_redelivery(message["ReceiptHandle"], delay_seconds)


def poll_until_stopped(
    task_queue: SqsQueueClient,
    result_queue: SqsQueueClient,
    dependencies: TaskDependencies,
    should_stop: Callable[[], bool],
) -> None:
    """Polls until should_stop() is true. Errors (e.g. SQS unreachable) are logged and retried
    after a pause instead of ending the worker; an undeleted task is redelivered by SQS."""
    while not should_stop():
        try:
            poll_task_queue_once(task_queue, result_queue, dependencies)
        except Exception:
            logger.exception(
                "Polling the task queue failed, retrying in %d seconds", POLL_ERROR_BACKOFF_SECONDS
            )
            time.sleep(POLL_ERROR_BACKOFF_SECONDS)


def run_worker() -> None:
    """Long-polls the ai_tasks queue and handles messages until asked to stop."""
    settings = load_settings()
    configure_tracing()
    task_queue = SqsQueueClient(settings, settings.ai_tasks_queue_name)
    result_queue = SqsQueueClient(settings, settings.ai_results_queue_name)
    dependencies = TaskDependencies(
        settings=settings,
        file_storage=S3FileStorage(settings),
        http_client=build_http_client(settings),
        read_gap_analysis_context=build_database_context_reader(settings),
        read_career_library=build_database_library_reader(settings),
        read_screening_successes=build_database_screening_reader(settings),
    )

    stop_requested = False

    def request_stop(signal_number: int, _frame: object) -> None:
        """Finishes the current message, then exits the polling loop."""
        nonlocal stop_requested
        logger.info("Received signal %d, stopping after current message", signal_number)
        stop_requested = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    logger.info("Worker polling queue %s", settings.ai_tasks_queue_name)
    poll_until_stopped(task_queue, result_queue, dependencies, lambda: stop_requested)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    run_worker()
