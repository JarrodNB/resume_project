"""
Description: Tests for classifying task failures as temporary (retry) or permanent (fail now).
Index:
    - test_*: one behavior per test
"""

import pytest
from botocore.exceptions import ClientError, EndpointConnectionError, ReadTimeoutError
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError, UnexpectedModelBehavior

from worker.retryable_errors import is_retryable_error


def build_client_error(code: str, status: int) -> ClientError:
    """Builds a botocore ClientError with the given AWS error code and HTTP status."""
    response = {"Error": {"Code": code}, "ResponseMetadata": {"HTTPStatusCode": status}}
    return ClientError(response, "GetObject")


@pytest.mark.parametrize("status_code", [408, 429, 500, 503])
def test_model_rate_limits_and_server_errors_are_retryable(status_code: int) -> None:
    """Rate limits, timeouts, and provider outages can succeed later."""
    assert is_retryable_error(ModelHTTPError(status_code=status_code, model_name="m"))


@pytest.mark.parametrize("status_code", [400, 401, 404])
def test_model_client_errors_are_permanent(status_code: int) -> None:
    """A bad request or bad API key fails the same way every time."""
    assert not is_retryable_error(ModelHTTPError(status_code=status_code, model_name="m"))


def test_model_connection_errors_are_retryable() -> None:
    """Pydantic AI reports connection errors and timeouts as a plain ModelAPIError."""
    assert is_retryable_error(ModelAPIError(model_name="m", message="Connection error."))


def test_agent_run_deadline_is_retryable() -> None:
    """An agent run cancelled at its deadline may finish in time on the next attempt."""
    assert is_retryable_error(TimeoutError())


def test_aws_network_errors_are_retryable() -> None:
    """S3/SQS unreachable or timing out can succeed later."""
    assert is_retryable_error(EndpointConnectionError(endpoint_url="http://s3:9090"))
    assert is_retryable_error(ReadTimeoutError(endpoint_url="http://s3:9090"))


def test_aws_throttling_and_server_errors_are_retryable() -> None:
    """Throttling codes and 5xx responses are temporary."""
    assert is_retryable_error(build_client_error("SlowDown", 503))
    assert is_retryable_error(build_client_error("InternalError", 500))


def test_missing_s3_object_is_permanent() -> None:
    """A missing upload will still be missing next time."""
    assert not is_retryable_error(build_client_error("NoSuchKey", 404))


def test_other_errors_are_permanent() -> None:
    """Bugs and bad model output aren't retried."""
    assert not is_retryable_error(RuntimeError("bug"))
    assert not is_retryable_error(UnexpectedModelBehavior("bad output"))
