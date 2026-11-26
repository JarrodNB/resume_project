"""Publish the interviewer's spoken text while the model is still writing it.

Only real answer turns stream. The text mirrors what Rails will save and speak: the
acknowledgement, a blank line, then the follow-up when the decision is to continue.
The blank line is sent as soon as the acknowledgement is whole; when the interviewer
moves on, Rails puts the next question or closing after it instead. On the final allowed
answer Rails always moves on, so a follow-up the model writes then is never streamed.
It is provisional: a validation retry or failure can leave it unfinished, and only
Rails acceptance makes it canonical. Contact placeholders are held back until whole
and restored before publishing. A lost output buffer never affects the turn itself.
"""

import asyncio

from pydantic_ai.messages import PartDeltaEvent, PartStartEvent, ToolCallPart, ToolCallPartDelta
from pydantic_core import from_json

from privacy.contact_mask import current_known_contact

# Match chat: publish at most every 50 ms, in events of at most 4,096 characters.
PUBLISH_INTERVAL_SECONDS = 0.05
MAX_DELTA_CHARACTERS = 4096


def spoken_text(acknowledgement, decision, reply):
    """Join interviewer text the way Rails composes saved spoken content.

    Keep in step with `Interviews::MessageText.spoken_content` in services/api. The browser hands
    streamed speech over to the saved reply only when the saved text starts with this text.
    """
    parts = [acknowledgement] if isinstance(acknowledgement, str) and acknowledgement else []
    if decision == "continue" and isinstance(reply, str) and reply:
        parts.append(reply)
    return "\n\n".join(parts)


class SpokenTextStream:
    """Turn one claim's optional output sink into ordered spoken-text events."""

    def __init__(self, output):
        self.output = output
        self.published = ""
        self.last_publish = None
        self.finished = False
        self.final_answer = False

    async def start(self, *, final_answer=False):
        """Begin the turn. On the final allowed answer Rails always moves on, so only the
        acknowledgement is spoken text; any follow-up the model writes is never saved."""
        self.final_answer = final_answer
        await self.output.emit("started")

    async def handle_events(self, ctx, events):
        """Pydantic AI stream handler: each call covers one model response or tool step."""
        loop = asyncio.get_running_loop()
        index, arguments = None, ""
        async for event in events:
            if isinstance(event, PartStartEvent) and isinstance(event.part, ToolCallPart) and index is None:
                index, arguments = event.index, _arguments(event.part.args)
            elif (isinstance(event, PartDeltaEvent) and event.index == index
                  and isinstance(event.delta, ToolCallPartDelta)):
                arguments += _arguments(event.delta.args_delta)
            else:
                continue
            if self.last_publish is None or loop.time() - self.last_publish >= PUBLISH_INTERVAL_SECONDS:
                await self._publish(_partial_spoken_text(arguments, final_answer=self.final_answer))
                self.last_publish = loop.time()

    async def finish(self, reply):
        """Publish whatever is left of the validated reply before acceptance."""
        decision = "advance" if self.final_answer else reply.decision
        final = spoken_text(reply.acknowledgement, decision, reply.reply)
        if final.startswith(self.published):
            await self._deltas(final[len(self.published):])
            self.published = final

    async def complete(self):
        self.finished = True
        await self.output.emit("completed")

    async def cancel(self):
        if not self.finished:
            self.finished = True
            await self.output.emit("cancelled")

    async def close(self):
        """Mark any turn that ended without acceptance as failed for observers."""
        if not self.finished:
            self.finished = True
            await self.output.emit("failed")

    async def _publish(self, text):
        # Hold an incomplete «placeholder» until its closing mark arrives.
        if text.rfind("«") > text.rfind("»"):
            text = text[:text.rfind("«")]
        restored = current_known_contact().unmask(text)
        # A retried model response may disagree with text already published; stop then.
        if restored.startswith(self.published):
            await self._deltas(restored[len(self.published):])
            self.published = restored

    async def _deltas(self, text):
        for start in range(0, len(text), MAX_DELTA_CHARACTERS):
            await self.output.emit("delta", text=text[start:start + MAX_DELTA_CHARACTERS])


def _arguments(value):
    return value if isinstance(value, str) else ""


def _partial_spoken_text(arguments, *, final_answer=False):
    """Read spoken text from incomplete structured-output JSON; unreadable input is empty.

    Once the acknowledgement string is closed, it is followed by the blank line that Rails
    puts before the next text, so listeners know it is whole and can speak it straight away,
    even when the interviewer moves on and nothing else is streamed.
    """
    try:
        values = from_json(arguments, allow_partial="trailing-strings")
        closed = from_json(arguments, allow_partial=True)
    except ValueError:
        return ""
    if not isinstance(values, dict):
        return ""
    decision = "advance" if final_answer else values.get("decision")
    text = spoken_text(values.get("acknowledgement"), decision, values.get("reply"))
    if text and isinstance(closed, dict) and text == closed.get("acknowledgement"):
        text += "\n\n"
    return text
