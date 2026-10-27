"""
Description: The request, tool-call, and token caps on every agent run. A hit fails the task.
There is no partial answer, and the task is not retried, because the same input would hit again.
Index:
    - RUN_LIMIT_MESSAGE: what the user is told
    - agent_usage_limits: builds the Pydantic AI limits from shared AI settings
"""

from pydantic_ai.usage import UsageLimits

from settings import AISettings

RUN_LIMIT_MESSAGE = "This task was stopped because it used too many model calls or tokens."


def agent_usage_limits(settings: AISettings) -> UsageLimits:
    """Returns the caps for one agent run. Numbers come from settings, not from agent code."""
    return UsageLimits(
        request_limit=settings.llm_request_limit,
        tool_calls_limit=settings.llm_tool_calls_limit,
        output_tokens_limit=settings.llm_output_tokens_limit,
        total_tokens_limit=settings.llm_total_tokens_limit,
    )
