"""
Description: Entry point for the AI worker. Long-polls the ai_tasks queue and handles each message.
Index:
    - handle_task_message: processes one task message (logs it until agents are added)
    - run_worker: polls the task queue until SIGTERM/SIGINT
"""

import logging
import signal

from worker.settings import load_settings
from worker.sqs_queue_client import SqsQueueClient

logger = logging.getLogger(__name__)


def handle_task_message(message_body: str) -> None:
    """Processes one task message. Placeholder until the agents are built."""
    logger.info("Received task message: %s", message_body)


def run_worker() -> None:
    """Long-polls the ai_tasks queue and handles messages until asked to stop."""
    settings = load_settings()
    task_queue = SqsQueueClient(settings, settings.ai_tasks_queue_name)

    stop_requested = False

    def request_stop(signal_number: int, _frame: object) -> None:
        """Finishes the current batch, then exits the polling loop."""
        nonlocal stop_requested
        logger.info("Received signal %d, stopping after current batch", signal_number)
        stop_requested = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)

    logger.info("Worker polling queue %s", settings.ai_tasks_queue_name)
    while not stop_requested:
        for message in task_queue.receive_messages():
            handle_task_message(message["Body"])
            task_queue.delete_message(message["ReceiptHandle"])


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    run_worker()
