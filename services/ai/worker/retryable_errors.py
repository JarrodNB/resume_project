"""Decide whether a failed task should wait for SQS redelivery or fail now.

Model providers and job-site fetches share one HTTP status policy. AWS error
codes, transport failures, and database outages have their own retry rules.
Usage limits and other permanent failures are reported without retrying.
"""

import httpx
import psycopg
from botocore.exceptions import ClientError, HTTPClientError, IncompleteReadError
from botocore.exceptions import ConnectionError as BotoConnectionError
from pydantic_ai.exceptions import ModelAPIError, ModelHTTPError

RETRYABLE_HTTP_STATUSES = {408, 409, 429}
RETRYABLE_AWS_ERROR_CODES = {
    "Throttling",
    "ThrottlingException",
    "SlowDown",
    "RequestTimeout",
    "RequestLimitExceeded",
}


def is_retryable_error(error: BaseException) -> bool:
    """True when the same task could succeed if tried again later."""
    if isinstance(error, (ModelHTTPError, httpx.HTTPStatusError)):
        status_code = (
            error.status_code if isinstance(error, ModelHTTPError) else error.response.status_code
        )
        return status_code in RETRYABLE_HTTP_STATUSES or status_code >= 500
    if isinstance(error, ModelAPIError):
        # Pydantic AI raises the base class for connection errors and timeouts.
        return True
    if isinstance(
        error,
        (
            TimeoutError,
            BotoConnectionError,
            HTTPClientError,
            IncompleteReadError,
            httpx.TransportError,
            psycopg.OperationalError,
        ),
    ):
        return True
    if isinstance(error, ClientError):
        return _is_retryable_aws_client_error(error)
    return False


def _is_retryable_aws_client_error(error: ClientError) -> bool:
    """True for AWS throttling and server-side errors."""
    code = error.response.get("Error", {}).get("Code", "")
    status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
    return code in RETRYABLE_AWS_ERROR_CODES or status >= 500
