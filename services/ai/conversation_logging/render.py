"""
Description: Readable complete model message parts and request schemas.
Index:
    - render_messages: roles, tool calls/results and validation retry labels
    - render_parameters: model-visible tool/output definitions
"""
import json
import re
from dataclasses import asdict, is_dataclass


def _json(value):
    """Formats structured values with safe binary metadata."""
    def fallback(item):
        """Describes unsupported/binary content without exposing binary payloads."""
        if isinstance(item, bytes):
            return f"[binary content: {len(item)} bytes]"
        if is_dataclass(item):
            return asdict(item)
        return str(item)
    return json.dumps(value, indent=2, ensure_ascii=False, default=fallback)


def _block(value, language="json"):
    """Chooses a fence long enough for any embedded backticks."""
    fence = "`" * max(3, max((len(run) + 1 for run in re.findall(r"`+", value)), default=3))
    return f"{fence}{language}\n{value}\n{fence}\n\n"


def render_messages(messages, parameters):
    """Labels full history snapshots while preserving all available message-part fields."""
    output_names = {tool.name for tool in parameters.output_tools}
    rendered = []
    for message in messages:
        for part in message.parts:
            kind = part.part_kind
            label = {"system-prompt": "System instructions", "user-prompt": "User", "text": "Assistant",
                     "tool-return": "Function tool result", "retry-prompt": "Validation retry"}.get(kind, kind)
            if kind == "tool-call":
                label = "Structured output tool call" if part.tool_name in output_names else "Function tool call"
            fields = asdict(part)
            if kind == "tool-call" and isinstance(part.args, str):
                try:
                    fields["args"] = json.loads(part.args)
                except ValueError:
                    pass
            content = fields.pop("content", None)
            rendered.append(f"#### {label}\n\n")
            if content is not None:
                rendered.append(_block(content, "text") if isinstance(content, str) else _block(_json(content)))
            rendered.append(_block(_json(fields)))
    return "".join(rendered)


def render_parameters(parameters):
    """Includes schemas and output instructions accompanying the messages."""
    return "#### Model request parameters\n\n" + _block(_json(asdict(parameters)))
