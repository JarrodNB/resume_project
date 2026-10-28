"""Render selected accepted chat sources without choosing or approving the records.

Rolling memory and dialogue remain labeled data. Callers own checkpoints, screening
provenance and provider work; these functions only format the supplied sources.
"""
from model_inputs.blocks import source_block


def render_chat_summary(previous_summary, messages):
    sections = [source_block("previous_summary", previous_summary)] if previous_summary else []
    for message in messages:
        sections.append(f"Accepted message {message.position} ({message.role}):\n" +
                        source_block("accepted_message", message.content))
    return "\n\n".join(sections)


def render_chat_summary_context(summary):
    return source_block("conversation_summary", summary)
