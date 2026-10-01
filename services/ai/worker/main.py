"""
Description: Entry point for the AI worker. Long-polls the ai_tasks queue, handles each task, and
publishes its result to ai_results.
Index:
    - process_task_message: handles one raw task message; says whether it can be deleted
    - run_worker: polls the task queue until SIGTERM/SIGINT
"""

import logging
import signal

from pydantic import ValidationError

from worker.queue_messages import AiResultMessage, AiTaskMessage
from worker.settings import load_settings
from worker.sqs_queue_client import SqsQueueClient
from worker.task_handlers import handle_ai_task

logger = logging.getLogger(__name__)


def process_task_message(message_body: str, result_queue: SqsQueueClient) -> bool:
    """Handles one raw task message and publishes its result.

    Returns True once a result is published, so the task message can be deleted. An invalid
    message returns False and is left for SQS to move to the dead-letter queue. A failing
    handler publishes a "failed" result; if publishing itself fails, the error propagates and
    the task is redelivered.
    """
    try:
        task = AiTaskMessage.model_validate_json(message_body)
    except ValidationError:
        logger.exception(
            "Invalid task message, leaving it for the dead-letter queue: %s", message_body
        )
        return False

    try:
        result = handle_ai_task(task)
    except Exception:
        logger.exception("Task %s failed", task.ai_task_id)
        result = AiResultMessage(
            ai_task_id=task.ai_task_id, status="failed", error_message="The AI task failed"
        )

    result_queue.send_message(result.model_dump_json())
    logger.info("Published %s result for task %s", result.status, task.ai_task_id)
    return True


def run_worker() -> None:
    """Long-polls the ai_tasks queue and handles messages until asked to stop."""
    settings = load_settings()
    task_queue = SqsQueueClient(settings, settings.ai_tasks_queue_name)
    result_queue = SqsQueueClient(settings, settings.ai_results_queue_name)

    stop_requested = False

    def request_stop(signal_number: int, _frame: object) -> None:
        """Finishes the current message, then exits the polling loop."""
        nonlocal stop_requested
        logger.info("Received signal %d, stopping after current message", signal_number)
        stop_requested = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    logger.info("Worker polling queue %s", settings.ai_tasks_queue_name)
    while not stop_requested:
        for message in task_queue.receive_messages():
            if process_task_message(message["Body"], result_queue):
                task_queue.delete_message(message["ReceiptHandle"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    run_worker()
