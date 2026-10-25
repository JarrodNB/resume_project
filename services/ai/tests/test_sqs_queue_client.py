"""Check the real SQS adapter's polling contract without contacting AWS.

Workers must receive one task at a time and retain its delivery count so slow
tasks do not idle in a batch and final attempts can publish a failure.
"""

from contextlib import closing

import boto3
import pytest
from botocore.stub import Stubber

from worker.settings import WorkerSettings
from worker.sqs_queue_client import SqsQueueClient


@pytest.mark.parametrize("wait_seconds", [0, 17])
@pytest.mark.parametrize("has_message", [False, True])
def test_receives_one_task_with_its_attempt_count(
    monkeypatch: pytest.MonkeyPatch, wait_seconds: int, has_message: bool
) -> None:
    """Immediate and long polls preserve raw messages; an empty poll returns a list."""
    queue_url = "https://sqs.us-east-1.amazonaws.com/123456789012/ai_tasks"
    messages = [{
        "MessageId": "00000000-0000-0000-0000-000000000001",
        "ReceiptHandle": "receipt-for-this-attempt",
        "Body": "synthetic task body",
        "Attributes": {"ApproximateReceiveCount": "3"},
    }] if has_message else []
    settings = WorkerSettings(receive_wait_seconds=wait_seconds)

    with closing(boto3.client(
        "sqs", region_name="us-east-1",
        aws_access_key_id="offline-test-key", aws_secret_access_key="offline-test-secret",
    )) as client, Stubber(client) as stubber:
        stubber.add_response("get_queue_url", {"QueueUrl": queue_url}, {"QueueName": "ai_tasks"})
        stubber.add_response(
            "receive_message", {"Messages": messages} if has_message else {},
            {
                "QueueUrl": queue_url,
                "MaxNumberOfMessages": 1,
                "WaitTimeSeconds": wait_seconds,
                "AttributeNames": ["ApproximateReceiveCount"],
            },
        )
        monkeypatch.setattr("worker.sqs_queue_client.boto3.client", lambda *_a, **_kw: client)
        queue = SqsQueueClient(settings, "ai_tasks")

        assert queue.receive_messages() == messages
        stubber.assert_no_pending_responses()
