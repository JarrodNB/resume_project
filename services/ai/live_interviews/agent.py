"""Connect one live interview's LiveKit room to the controller, the realtime model and Rails.

This adapter stays thin on purpose. It reads the dispatch metadata (only the session and
connection IDs), claims the connection with Rails, loads the interview's inputs read-only,
builds the instructions and starts a LiveKit `AgentSession` on the OpenAI realtime model. From
then on it forwards session events into the controller and carries out the actions it returns:
speak, report to Rails, and publish progress as agent participant attributes. All interview
decisions live in the controller; nothing here is recorded (`record=False`).
"""

import asyncio
import logging

from livekit.agents import Agent, ConversationItemAddedEvent, llm
from openai.types.realtime import AudioTranscription
from openai.types.realtime.realtime_audio_input_turn_detection import ServerVad
from psycopg import Error as DatabaseError
from pydantic import BaseModel, ConfigDict

from interviews.conversation import ContextLimitExceeded
from live_interviews.client import RailsClientError, RailsTransportError
from live_interviews.controller import (
    GenerateReply,
    InterviewerTurnFinished,
    LiveAction,
    LiveEvent,
    LiveInterviewController,
    PublishRoomState,
    ReportPromptAsked,
    Started,
)
from live_interviews.instructions import build_live_instructions
from live_interviews.settings import PERSONA_VOICES, LiveInterviewSettings

logger = logging.getLogger(__name__)


class LiveDispatch(BaseModel):
    """The job metadata Rails puts in the join token: identities only, never content."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    interview_session_id: str
    live_connection_id: str


def realtime_model_options(settings: LiveInterviewSettings, persona: str) -> dict:
    """Keyword arguments for `openai.realtime.RealtimeModel`: model, persona voice, server VAD
    turn detection and input transcription (for the candidate's captions)."""
    return {
        "model": settings.live_interview_model,
        "voice": PERSONA_VOICES[persona],
        "turn_detection": ServerVad(type="server_vad", create_response=True, interrupt_response=True),
        "input_audio_transcription": AudioTranscription(model=settings.live_interview_transcription_model),
    }


class LiveInterviewRunner:
    """Feed one session's events to the controller and carry out its actions in order."""

    def __init__(self, *, session, rails, connection_id: str, room):
        self._session, self._rails, self._connection_id, self._room = session, rails, connection_id, room
        self._controller = LiveInterviewController()
        self._lock = asyncio.Lock()
        self._tasks: set[asyncio.Task] = set()

    def on_conversation_item_added(self, event: ConversationItemAddedEvent) -> None:
        """LiveKit callback: a final interviewer message becomes an `InterviewerTurnFinished`."""
        item = event.item
        if isinstance(item, llm.ChatMessage) and item.role == "assistant":
            task = asyncio.create_task(self.handle(InterviewerTurnFinished(item.text_content or "")))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def handle(self, event: LiveEvent) -> None:
        async with self._lock:
            for action in self._controller.handle(event):
                await self._carry_out(action)

    async def _carry_out(self, action: LiveAction) -> None:
        if isinstance(action, GenerateReply):
            self._session.generate_reply(instructions=action.instructions)
        elif isinstance(action, ReportPromptAsked):
            try:
                await self._rails.prompt_asked(self._connection_id, question_position=action.question_position,
                                               kind=action.kind, text=action.text)
            except (RailsClientError, RailsTransportError) as error:
                # Never log the spoken text; Rails refusals mean the prompt is stale.
                logger.warning("Live prompt was not saved: %s", type(error).__name__)
        elif isinstance(action, PublishRoomState):
            await self._room.local_participant.set_attributes({
                "cd.question_position": str(action.question_position),
                "cd.question_total": str(action.question_total),
                "cd.phase": action.phase,
            })


async def run_live_interview(ctx, *, rails, read_inputs, make_session) -> None:
    """Run one dispatched live interview job.

    `rails` is a RailsLiveInterviewClient, `read_inputs(interview_id=, user_id=, connection_id=)`
    loads LiveInterviewInputs, and `make_session(persona)` builds the AgentSession.
    A refused or unreadable start ends the job without starting the model.
    """
    ctx.add_shutdown_callback(rails.aclose)
    await ctx.connect()
    try:
        dispatch = LiveDispatch.model_validate_json(ctx.job.metadata)
        claim = await rails.claim(dispatch.live_connection_id, room_name=ctx.room.name)
        if claim.interview_session_id != dispatch.interview_session_id:
            raise ValueError("Live claim belongs to another interview")
        inputs = await asyncio.to_thread(read_inputs, interview_id=claim.interview_session_id,
                                         user_id=claim.user_id, connection_id=claim.live_connection_id)
        instructions = build_live_instructions(inputs)
    except (RailsClientError, RailsTransportError, DatabaseError, ContextLimitExceeded, ValueError) as error:
        logger.warning("Live interview could not start: %s", type(error).__name__)
        ctx.shutdown(reason="live interview unavailable")
        return
    session = make_session(inputs.setup.interviewer)
    runner = LiveInterviewRunner(session=session, rails=rails, connection_id=claim.live_connection_id, room=ctx.room)
    session.on("conversation_item_added", runner.on_conversation_item_added)
    await session.start(Agent(instructions=instructions), room=ctx.room, record=False)
    await runner.handle(Started(question_position=claim.current_question_position,
                                question_total=claim.question_total))
