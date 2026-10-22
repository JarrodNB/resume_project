"""Check saved interview tool exchanges, including SDK output-validation retries.

Retries can close only the exact tool call they reject. Malformed private history
must still fail before another interview execution can reuse it.
"""

import pytest
from pydantic_ai.messages import (
    ModelRequest,
    ModelResponse,
    RetryPromptPart,
    ToolCallPart,
    ToolReturnPart,
)

from interviews.history import serialize_history


def call():
    return ModelResponse(parts=[ToolCallPart("final_result", {}, tool_call_id="output")])


def test_general_retry_with_sdk_generated_id_does_not_need_a_tool_call():
    assert serialize_history([ModelRequest(parts=[RetryPromptPart("Please try again")])])


@pytest.mark.parametrize("parts", [
    [RetryPromptPart("Invalid", tool_name="other", tool_call_id="output")],
    [RetryPromptPart("Invalid", tool_name="final_result", tool_call_id="missing")],
    [RetryPromptPart("Invalid", tool_call_id="output")],
    [RetryPromptPart("Invalid", tool_name="final_result", tool_call_id="output"),
     RetryPromptPart("Invalid", tool_name="final_result", tool_call_id="output")],
    [RetryPromptPart("Invalid", tool_name="final_result", tool_call_id="output"),
     ToolReturnPart("final_result", "ok", tool_call_id="output")],
])
def test_invalid_retry_pairing_is_rejected(parts):
    with pytest.raises(ValueError, match="Unpaired"):
        serialize_history([call(), ModelRequest(parts=parts)])


def test_named_retry_without_a_call_is_rejected():
    with pytest.raises(ValueError, match="Unpaired"):
        serialize_history([ModelRequest(parts=[
            RetryPromptPart("Invalid", tool_name="final_result", tool_call_id="missing")])])


def test_retry_does_not_hide_duplicate_pending_calls():
    with pytest.raises(ValueError, match="Duplicate"):
        serialize_history([call(), call(), ModelRequest(parts=[
            RetryPromptPart("Invalid", tool_name="final_result", tool_call_id="output")])])
