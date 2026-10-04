"""
Description: Decides whether a task failure is temporary (worth retrying via SQS redelivery) or
permanent (report "failed" now). Covers the model provider (through Pydantic AI), AWS, job
site fetches (httpx), and the database (psycopg).
Index:
    - is_retryable_error: True for rate limits, provider/AWS/job site 5xx, timeouts (including an
      agent run that hit its deadline), network errors, and the database being unreachable
"""

import httpx
import psycopg
from botocore.exceptions import ClientError, HTTPClientError
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
    if isinstance(error, ModelHTTPError):
        return error.status_code in RETRYABLE_HTTP_STATUSES or error.status_code >= 500
    if isinstance(error, ModelAPIError):
        # Pydantic AI raises the base class for connection errors and timeouts.
        return True
    if isinstance(error, httpx.HTTPStatusError):
        status_code = error.response.status_code
        return status_code in RETRYABLE_HTTP_STATUSES or status_code >= 500
    if isinstance(
        error,
        (
            TimeoutError,
            BotoConnectionError,
            HTTPClientError,
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
