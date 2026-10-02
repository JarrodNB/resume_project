"""
Description: Thin wrapper around one SQS queue (works with AWS SQS and local ElasticMQ).
Index:
    - SqsQueueClient: receive, delete, and send messages on a single named queue
    - SqsQueueClient.receive_messages: long-polls for at most one message (with its receive count)
    - SqsQueueClient.delete_message: acknowledges a processed message
    - SqsQueueClient.delay_redelivery: makes a received message visible again after a delay
    - SqsQueueClient.send_message: publishes a message body to the queue
"""

import logging
import time

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from worker.settings import WorkerSettings

logger = logging.getLogger(__name__)

QUEUE_LOOKUP_ATTEMPTS = 15
QUEUE_LOOKUP_RETRY_SECONDS = 2


class SqsQueueClient:
    """Wraps one SQS queue, resolving its URL once at startup."""

    def __init__(self, settings: WorkerSettings, queue_name: str) -> None:
        """Creates the boto3 client and resolves the queue URL, retrying while SQS starts up."""
        self._sqs = boto3.client(
            "sqs", region_name=settings.aws_region, endpoint_url=settings.sqs_endpoint_url
        )
        self._receive_wait_seconds = settings.receive_wait_seconds
        self._queue_url = self._resolve_queue_url(queue_name)

    def _resolve_queue_url(self, queue_name: str) -> str:
        """Looks up the queue URL, retrying because the SQS container may still be starting."""
        for attempt in range(1, QUEUE_LOOKUP_ATTEMPTS + 1):
            try:
                return self._sqs.get_queue_url(QueueName=queue_name)["QueueUrl"]
            except (BotoCoreError, ClientError) as error:
                logger.warning(
                    "Queue %s not reachable (attempt %d): %s", queue_name, attempt, error
                )
                time.sleep(QUEUE_LOOKUP_RETRY_SECONDS)
        raise RuntimeError(f"Could not resolve SQS queue URL for {queue_name}")

    def receive_messages(self) -> list[dict]:
        """Long-polls the queue and returns at most one raw SQS message.

        One at a time because AI tasks are slow: messages waiting in a local batch would
        exceed their visibility timeout and be redelivered to other workers. Scale by
        running more workers instead.
        """
        response = self._sqs.receive_message(
            QueueUrl=self._queue_url,
            MaxNumberOfMessages=1,
            WaitTimeSeconds=self._receive_wait_seconds,
            AttributeNames=["ApproximateReceiveCount"],
        )
        return response.get("Messages", [])

    def delete_message(self, receipt_handle: str) -> None:
        """Deletes a processed message so it isn't redelivered."""
        self._sqs.delete_message(QueueUrl=self._queue_url, ReceiptHandle=receipt_handle)

    def delay_redelivery(self, receipt_handle: str, delay_seconds: int) -> None:
        """Makes a received message visible again after delay_seconds instead of the queue's
        full visibility timeout."""
        self._sqs.change_message_visibility(
            QueueUrl=self._queue_url, ReceiptHandle=receipt_handle, VisibilityTimeout=delay_seconds
        )

    def send_message(self, message_body: str) -> None:
        """Publishes a message body to the queue."""
        self._sqs.send_message(QueueUrl=self._queue_url, MessageBody=message_body)
