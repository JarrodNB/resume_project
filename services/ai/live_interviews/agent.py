"""Connect one live interview's LiveKit room to the controller, the realtime model and Rails.

This adapter stays thin on purpose. It reads the dispatch metadata (only the session and
connection IDs), claims the connection with Rails, loads the interview's inputs read-only,
builds the instructions and starts a LiveKit `AgentSession` on the OpenAI realtime model. From
then on it forwards events into the controller: final transcripts of both sides, the model's
interview tools (`ask_follow_up`, `finish_answer`, `repeat_question`, `next_question`,
`give_feedback`, `offer_menu`, `give_hint`, `retry_question`), a clock tick about once a second
and the room's `interview.choose` RPC (`{"option": ...}` with `retry`, `repeat`, `hint`, `next`,
`feedback` or `end`; a button interrupts whatever the interviewer is saying). It carries out the
actions the controller returns: speak, report to Rails, publish progress as agent participant
attributes and leave. All interview decisions live in the controller; nothing here is recorded
(`record=False`) and spoken text is never logged.
"""

import asyncio
import json
import logging
import time

from livekit import rtc
from livekit.agents import Agent, ConversationItemAddedEvent, function_tool, llm
from openai.types.realtime import AudioTranscription
from openai.types.realtime.realtime_audio_input_turn_detection import ServerVad
from psycopg import Error as DatabaseError
from pydantic import BaseModel, ConfigDict

from interviews.conversation import ContextLimitExceeded
from live_interviews.client import RailsClientError, RailsTransportError
from live_interviews.controller import (
    AskFollowUp,
    CandidateTurnFinished,
    EndRequested,
    EndSession,
    FinishAnswer,
    GenerateReply,
    GiveFeedback,
    GiveHint,
    InterviewerTurnFinished,
    LiveAction,
    LiveEvent,
    LiveInterviewController,
    MenuChoice,
    NextQuestion,
    OfferMenu,
    PromptRecorded,
    PublishRoomState,
    RepeatQuestion,
    ReportAnswerFinished,
    ReportFeedbackGiven,
    ReportFinish,
    ReportPromptAsked,
    ReportQuestionAdvanced,
    ReportQuestionRetried,
    RetryQuestion,
    Started,
    Tick,
    ToolResult,
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


MENU_OPTIONS = frozenset({"retry", "repeat", "hint", "next", "feedback"})


class LiveInterviewRunner:
    """Feed one session's events to the controller and carry out its actions in order."""

    def __init__(self, *, session, rails, connection_id: str, room, leave, clock=time.monotonic):
        self._session, self._rails, self._connection_id, self._room = session, rails, connection_id, room
        self._leave, self._clock = leave, clock
        self._controller = LiveInterviewController()
        self._lock = asyncio.Lock()
        self._tasks: set[asyncio.Task] = set()
        self.finished = False  # Rails accepted the finish
        self._left = False

    def on_conversation_item_added(self, event: ConversationItemAddedEvent) -> None:
        """LiveKit callback: final interviewer and candidate messages become controller events."""
        item = event.item
        if isinstance(item, llm.ChatMessage) and item.role in ("assistant", "user"):
            text = item.text_content or ""
            turn = InterviewerTurnFinished(text) if item.role == "assistant" else CandidateTurnFinished(text)
            task = asyncio.create_task(self.handle(turn))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def handle(self, event: LiveEvent) -> str | None:
        """Carry out the event's actions; returns the tool result text for tool events."""
        async with self._lock:
            return await self._dispatch(event)

    async def tick_forever(self, seconds: float = 1.0) -> None:
        """Send the controller the clock about once a second until the interview finishes."""
        while not self._left:
            await asyncio.sleep(seconds)
            await self.handle(Tick(self._clock()))

    async def choose(self, data: rtc.RpcInvocationData) -> str:
        """The room's `interview.choose` RPC: a menu button, "How was that?" or End interview."""
        try:
            option = json.loads(data.payload).get("option")
        except (ValueError, AttributeError):
            option = None
        if not isinstance(option, str) or option not in MENU_OPTIONS | {"end"}:
            raise rtc.RpcError(2001, "Unknown interview option")
        self._session.interrupt()
        if option in MENU_OPTIONS:
            await self.handle(MenuChoice(option))
            return "accepted"
        await self.handle(EndRequested())
        if not self.finished:
            raise rtc.RpcError(2002, "The interview could not be finished")
        return "ended"

    async def _dispatch(self, event: LiveEvent) -> str | None:
        result = None
        for action in self._controller.handle(event):
            if isinstance(action, ToolResult):
                result = action.text
            else:
                await self._carry_out(action)
        return result

    async def _report(self, call, **values):
        """Call Rails; a refusal means the report was stale, so it is logged (never its text) and skipped."""
        try:
            return await call(self._connection_id, **values)
        except (RailsClientError, RailsTransportError) as error:
            logger.warning("Live report %s was not saved: %s", call.__name__, type(error).__name__)
            return None

    async def _carry_out(self, action: LiveAction) -> None:
        if isinstance(action, GenerateReply):
            self._session.generate_reply(instructions=action.instructions)
        elif isinstance(action, ReportPromptAsked):
            receipt = await self._report(self._rails.prompt_asked, question_position=action.question_position,
                                         kind=action.kind, text=action.text)
            if receipt and isinstance(receipt.get("message_id"), str):
                await self._dispatch(PromptRecorded(action.question_position, receipt["message_id"]))
        elif isinstance(action, ReportAnswerFinished):
            await self._report(self._rails.answer_finished, prompt_message_id=action.prompt_message_id,
                               transcript=action.transcript)
        elif isinstance(action, ReportQuestionAdvanced):
            await self._report(self._rails.question_advanced, question_position=action.question_position)
        elif isinstance(action, ReportFeedbackGiven):
            await self._report(self._rails.feedback_given, question_position=action.question_position, text=action.text)
        elif isinstance(action, ReportQuestionRetried):
            await self._report(self._rails.question_retried, question_position=action.question_position,
                               retry_number=action.retry_number)
        elif isinstance(action, ReportFinish):
            self.finished = await self._report(self._rails.finish, reason=action.reason) is not None
        elif isinstance(action, PublishRoomState):
            await self._room.local_participant.set_attributes({
                "cd.question_position": str(action.question_position),
                "cd.question_total": str(action.question_total),
                "cd.phase": action.phase,
                "cd.menu_offered": "true" if action.menu_offered else "false",
            })
        elif isinstance(action, EndSession):
            self._left = True
            self._leave()


class LiveInterviewerAgent(Agent):
    """The realtime interviewer. Its tools only forward to the controller and return its answer."""

    def __init__(self, *, instructions: str, runner: LiveInterviewRunner):
        super().__init__(instructions=instructions)
        self._runner = runner

    @function_tool
    async def ask_follow_up(self, question_text: str) -> str:
        """Ask one follow-up about the candidate's answer to the current question. Call this before
        you speak the follow-up; the result says whether to ask it or to move on instead.

        Args:
            question_text: The follow-up question you want to ask, in a few words.
        """
        return await self._runner.handle(AskFollowUp(question_text)) or ""

    @function_tool
    async def finish_answer(self) -> str:
        """Record that the candidate has finished answering the current question or follow-up."""
        return await self._runner.handle(FinishAnswer()) or ""

    @function_tool
    async def repeat_question(self) -> str:
        """Use when the candidate asks to hear the current question or follow-up again."""
        return await self._runner.handle(RepeatQuestion()) or ""

    @function_tool
    async def next_question(self) -> str:
        """Move on from the current question when you have no more follow-ups for it. The result says
        which question to ask next, or how to close the interview after the last one."""
        return await self._runner.handle(NextQuestion()) or ""

    @function_tool
    async def give_feedback(self) -> str:
        """Use when the candidate asks how they did ("How was that?"). The result says how to give the
        quick feedback; the words you then speak are saved as the feedback."""
        return await self._runner.handle(GiveFeedback()) or ""

    @function_tool
    async def offer_menu(self) -> str:
        """Use when the candidate is done with the current question or asks what they can do next. The
        result says whether to give feedback first or which choices to offer."""
        return await self._runner.handle(OfferMenu()) or ""

    @function_tool
    async def give_hint(self) -> str:
        """Use when the candidate asks for a hint. The result says how to hint without giving an answer."""
        return await self._runner.handle(GiveHint()) or ""

    @function_tool
    async def retry_question(self) -> str:
        """Use when the candidate wants to try the whole question again. The result says whether a retry
        is left and what to ask."""
        return await self._runner.handle(RetryQuestion()) or ""


async def run_live_interview(ctx, *, rails, read_inputs, make_session, clock=time.monotonic,
                             tick_seconds: float = 1.0) -> None:
    """Run one dispatched live interview job.

    `rails` is a RailsLiveInterviewClient, `read_inputs(interview_id=, user_id=, connection_id=)`
    loads LiveInterviewInputs, and `make_session(persona)` builds the AgentSession. `clock` and
    `tick_seconds` drive the controller's clock (tests pass a fake clock).
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
    runner = LiveInterviewRunner(session=session, rails=rails, connection_id=claim.live_connection_id, room=ctx.room,
                                 leave=lambda: ctx.shutdown(reason="live interview finished"), clock=clock)
    session.on("conversation_item_added", runner.on_conversation_item_added)
    ctx.room.local_participant.register_rpc_method("interview.choose", runner.choose)
    await session.start(LiveInterviewerAgent(instructions=instructions, runner=runner), room=ctx.room, record=False)
    await runner.handle(Started(question_position=claim.current_question_position,
                                question_total=claim.question_total, answer_cap=claim.answer_cap,
                                retry_count=claim.current_question_retry_count))
    ticker = asyncio.create_task(runner.tick_forever(tick_seconds))

    async def stop_ticking() -> None:
        ticker.cancel()

    ctx.add_shutdown_callback(stop_ticking)
