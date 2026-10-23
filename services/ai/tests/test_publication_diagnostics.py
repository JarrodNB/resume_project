"""Diagnose queue delivery failure with safe metadata even without local capture."""
import logging
from types import SimpleNamespace
from uuid import uuid4

import pytest

from conversation_logging import publish_result
from worker.queue_messages import AiResultMessage


@pytest.mark.parametrize("status", ["usage", "completed", "failed"])
def test_failed_publication_logs_only_correlating_metadata(caplog, status):
    task_id, attempt_id = uuid4(), uuid4()
    result = AiResultMessage(
        ai_task_id=task_id, attempt_id=attempt_id, status=status,
        result={"private": "private resume payload"},
    )
    error = ConnectionError("private transport detail")

    def send(_body):
        raise error

    with caplog.at_level(logging.WARNING), pytest.raises(ConnectionError) as caught:
        publish_result(SimpleNamespace(send_message=send), result)

    assert caught.value is error
    assert str(task_id) in caplog.text
    assert str(attempt_id) in caplog.text
    assert f"status={status}" in caplog.text
    assert "private resume payload" not in caplog.text
    assert "private transport detail" not in caplog.text
    assert len(caplog.records) == 1


def test_successful_publication_does_not_warn(caplog):
    sent = []
    result = AiResultMessage(ai_task_id=uuid4(), status="completed")
    with caplog.at_level(logging.WARNING):
        publish_result(SimpleNamespace(send_message=sent.append), result)
    assert sent == [result.model_dump_json()]
    assert not caplog.records
