"""
Description: Decides whether a task failure is temporary (worth retrying via SQS redelivery) or
permanent (report "failed" now). Covers the model provider (through Pydantic AI) and AWS.
Index:
    - is_retryable_error: True for rate limits, provider/AWS 5xx, timeouts (including an agent run
      that hit its deadline), and network errors
"""

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
    if isinstance(error, (TimeoutError, BotoConnectionError, HTTPClientError)):
        return True
    if isinstance(error, ClientError):
        return _is_retryable_aws_client_error(error)
    return False


def _is_retryable_aws_client_error(error: ClientError) -> bool:
    """True for AWS throttling and server-side errors."""
    code = error.response.get("Error", {}).get("Code", "")
    status = error.response.get("ResponseMetadata", {}).get("HTTPStatusCode", 0)
    return code in RETRYABLE_AWS_ERROR_CODES or status >= 500
