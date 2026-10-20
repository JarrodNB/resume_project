"""Round-trip bounded interview history using the pinned Pydantic AI wire format.

Saved history remains untrusted input and is screened on every claimed execution.
Tool calls must have their matching return before a later execution can restore them.
"""

import json

from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)


def restore_history(version: int, value: list[dict]):
    """Reject unsupported, oversized, or unpaired history before running an agent."""
    if version != 1 or len(json.dumps(value).encode()) > 262144:
        raise ValueError("Unsupported interview history")
    messages = ModelMessagesTypeAdapter.validate_python(value)
    pending = {}
    for message in messages:
        for part in message.parts:
            if isinstance(message, ModelResponse) and isinstance(part, ToolCallPart):
                if part.tool_call_id in pending:
                    raise ValueError("Duplicate tool call")
                pending[part.tool_call_id] = part.tool_name
            if isinstance(message, ModelRequest) and isinstance(part, ToolReturnPart):
                if pending.get(part.tool_call_id) != part.tool_name:
                    raise ValueError("Unpaired tool return")
                del pending[part.tool_call_id]
    if pending:
        raise ValueError("Unpaired tool call")
    return messages


def serialize_history(messages) -> list[dict]:
    """Save JSON-compatible messages, then validate the same restoration contract."""
    value = json.loads(ModelMessagesTypeAdapter.dump_json(messages))
    restore_history(1, value)
    return value
