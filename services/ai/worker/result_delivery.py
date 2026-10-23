"""Publish task results and diagnose failed delivery without logging payloads.

The worker owns queue delivery and production diagnostics. It also sends outcome
events to the optional local transcript hook, which is inactive outside local capture.
Failed sends propagate so the source task can be redelivered.
"""

import logging

from conversation_logging import record_outcome
from worker.queue_messages import AiResultMessage
from worker.sqs_queue_client import SqsQueueClient

logger = logging.getLogger(__name__)


def publish_result(queue: SqsQueueClient, result: AiResultMessage) -> None:
    """Send one result, retaining its original failure and reporting safe metadata."""
    try:
        queue.send_message(result.model_dump_json())
    except BaseException as error:
        logger.warning(
            "Task result publication failed: task_id=%s status=%s attempt_id=%s",
            result.ai_task_id, result.status, result.attempt_id,
        )
        record_outcome(
            f"{result.status} result publication failed ({type(error).__name__}); task will redeliver",
            event="PUBLICATION FAILURE",
        )
        raise
    if result.status != "usage":
        record_outcome(f"{result.status} result published")
    elif result.attempt_finished:
        record_outcome("retry pending; usage published", event="RETRY PENDING")
