"""Round-trip bounded interview history using the pinned Pydantic AI wire format.

Saved history remains untrusted input and is screened on every claimed execution.
Tool calls must have their matching return before a later execution can restore them.
Repeated context envelopes are reduced to transcripts only when they exactly match
the context that the current execution supplies and screens again.
"""

import json
from dataclasses import replace

from pydantic_ai.messages import (
    ModelMessagesTypeAdapter,
    ModelRequest,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
    UserPromptPart,
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


def compact_turn_history(messages, context: dict):
    """Keep transcripts, removing only exact copies of the current immutable context.

    The latest prompt supplies and screens that context again. Unknown historical
    inputs, changed context, model outputs and tool pairs remain untouched, so they
    still receive normal screening and size checks. This also handles old histories
    that saved a full context envelope on each response.
    """
    compacted = []
    for message in messages:
        if not isinstance(message, ModelRequest):
            compacted.append(message)
            continue
        parts = []
        for part in message.parts:
            if isinstance(part, UserPromptPart) and isinstance(part.content, str):
                try:
                    value = json.loads(part.content)
                except (ValueError, TypeError):
                    value = None
                if isinstance(value, dict) and isinstance(value.get("transcript"), str) and {
                    key: item for key, item in value.items() if key != "transcript"
                } == context:
                    part = replace(part, content=json.dumps({"transcript": value["transcript"]}, sort_keys=True))
            parts.append(part)
        compacted.append(replace(message, parts=parts))
    return compacted
