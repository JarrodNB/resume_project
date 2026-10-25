"""
Description: Tests for classifying task failures as temporary (retry) or permanent (fail now),
for model, AWS, and job site errors.
Index:
    - test_*: one behavior per test
"""

from contextlib import closing
from io import BytesIO

import httpx
import pytest
from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    IncompleteReadError,
    ReadTimeoutError,
)
from botocore.response import StreamingBody
from pydantic_ai.exceptions import (
    ModelAPIError,
    ModelHTTPError,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)

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


def test_truncated_s3_download_is_retryable() -> None:
    """A response ending before Content-Length can succeed on redelivery."""
    with (
        closing(StreamingBody(BytesIO(b"partial"), content_length=20)) as body,
        pytest.raises(IncompleteReadError) as caught,
    ):
        body.read()
    assert is_retryable_error(caught.value)


def test_aws_throttling_and_server_errors_are_retryable() -> None:
    """Throttling codes and 5xx responses are temporary."""
    assert is_retryable_error(build_client_error("SlowDown", 503))
    assert is_retryable_error(build_client_error("InternalError", 500))


@pytest.mark.parametrize(
    "code",
    ["Throttling", "ThrottlingException", "SlowDown", "RequestTimeout", "RequestLimitExceeded"],
)
@pytest.mark.parametrize("status", [400, 429])
def test_aws_retryable_codes_do_not_require_a_server_error(code: str, status: int) -> None:
    """AWS throttling and timeout codes warrant redelivery even on a 4xx response."""
    assert is_retryable_error(build_client_error(code, status))


@pytest.mark.parametrize("code", ["AccessDenied", "InvalidAccessKeyId", "SignatureDoesNotMatch"])
def test_aws_authorization_errors_are_permanent(code: str) -> None:
    """Bad credentials or missing access must not spend every SQS attempt retrying."""
    assert not is_retryable_error(build_client_error(code, 403))


def test_missing_s3_object_is_permanent() -> None:
    """A missing upload will still be missing next time."""
    assert not is_retryable_error(build_client_error("NoSuchKey", 404))


def build_http_status_error(status_code: int) -> httpx.HTTPStatusError:
    """Builds the error httpx raises for a job site response with the given status."""
    request = httpx.Request("GET", "https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/1")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError("error", request=request, response=response)


@pytest.mark.parametrize("status_code", [429, 500, 502])
def test_job_site_rate_limits_and_server_errors_are_retryable(status_code: int) -> None:
    """A job site that is busy or down may answer next time."""
    assert is_retryable_error(build_http_status_error(status_code))


def test_job_site_client_errors_are_permanent() -> None:
    """A forbidden page stays forbidden."""
    assert not is_retryable_error(build_http_status_error(403))


def test_job_site_network_errors_are_retryable() -> None:
    """Connection failures and timeouts while fetching a job page are temporary."""
    assert is_retryable_error(httpx.ConnectError("refused"))
    assert is_retryable_error(httpx.ReadTimeout("slow"))


def test_other_errors_are_permanent() -> None:
    """Bugs and bad model output aren't retried."""
    assert not is_retryable_error(RuntimeError("bug"))
    assert not is_retryable_error(UnexpectedModelBehavior("bad output"))
    assert not is_retryable_error(UsageLimitExceeded("request_limit of 6"))
