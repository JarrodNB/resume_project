"""Connect one live interview's LiveKit room to the controller, the realtime model and Rails.

This is the LiveKit adapter: interview decisions live in live_interviews.controller and delivery
to Rails in live_interviews.reporter. It claims the connection and reads the inputs before it
joins the room, turns LiveKit callbacks (transcripts, tool calls, the `interview.choose` RPC,
speaking state, participants, the session closing) into controller events, and carries out the
controller's actions. It never records audio and never logs spoken text.

The LiveKit behaviour it relies on (late transcripts, preambles, rejoining participants, a
session LiveKit closes on its own) is described with source references in
docs/architecture/interview-sessions.md, "Live conversation mode".
"""

import asyncio
import json
import logging
import time

from livekit import rtc
from livekit.agents import (
    Agent,
    AgentStateChangedEvent,
    CloseEvent,
    ConversationItemAddedEvent,
    RunContext,
    UserStateChangedEvent,
    function_tool,
    llm,
    room_io,
)
from livekit.agents.voice.events import CloseReason
from openai.types.realtime import AudioTranscription
from openai.types.realtime.realtime_audio_input_turn_detection import ServerVad
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict

from live_interviews.client import (
    RailsClientError,
    RailsTransportError,
)
from live_interviews.controller import (
    ENDED,
    AskFollowUp,
    CandidateJoined,
    CandidateLeft,
    CandidateTurnFinished,
    ClosingSpoken,
    ConnectionEnded,
    EndRequested,
    EndSession,
    FinishAnswer,
    GenerateReply,
    GiveFeedback,
    GiveHint,
    HeartbeatDue,
    HeartbeatReplied,
    InterviewerTurnFinished,
    LiveAction,
    LiveEvent,
    LiveInterviewController,
    MenuChoice,
    NextQuestion,
    OfferMenu,
    PublishRoomState,
    RepeatQuestion,
    ReportFinish,
    RetryQuestion,
    SayClosing,
    SendHeartbeat,
    SessionClosed,
    SpeakingChanged,
    Started,
    Tick,
    ToolEvent,
    ToolResult,
)
from live_interviews.instructions import build_live_instructions
from live_interviews.reporter import InterviewReport, LiveReporter
from live_interviews.settings import PERSONA_VOICES, REALTIME_MODEL, TRANSCRIPTION_MODEL
from live_interviews.usage import LiveUsageTotals

logger = logging.getLogger(__name__)


class LiveDispatch(BaseModel):
    """The job metadata Rails puts in the join token: identities only, never content."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    interview_session_id: str
    live_connection_id: str


def realtime_model_options(persona: str) -> dict:
    """Keyword arguments for `openai.realtime.RealtimeModel`: model, persona voice, server VAD
    turn detection and input transcription (for the candidate's captions)."""
    return {
        "model": REALTIME_MODEL,
        "voice": PERSONA_VOICES[persona],
        "turn_detection": ServerVad(type="server_vad", create_response=True, interrupt_response=True),
        "input_audio_transcription": AudioTranscription(model=TRANSCRIPTION_MODEL),
    }


MENU_OPTIONS = frozenset({"retry", "repeat", "hint", "next", "feedback"})
TRANSCRIPT_WAIT_SECONDS = 3.0  # how long a tool call waits for the candidate's late final transcript
DELIVERY_WAIT_SECONDS = 30.0  # how long leaving waits for reports still on their way to Rails


class LiveInterviewRunner:
    """Feed one session's events to the controller and carry out its actions in order.

    Controller steps run one at a time under a lock, but nothing under it waits for Rails: reports,
    heartbeats and the finish join one ordered delivery queue that a single background task sends
    through the reporter, and Rails' answers come back as controller events. So a slow Rails never
    holds up a tool result, a room choice, the clock or a transcript. Leaving waits (a bounded time)
    for the queue, so the finish still reaches Rails after everything reported before it.
    """

    def __init__(self, *, session, rails, connection_id: str, room, leave, clock=time.monotonic,
                 transcript_wait_seconds: float = TRANSCRIPT_WAIT_SECONDS,
                 delivery_wait_seconds: float = DELIVERY_WAIT_SECONDS):
        self._session, self._room = session, room
        self._leave, self._clock, self._transcript_wait_seconds = leave, clock, transcript_wait_seconds
        self._delivery_wait_seconds = delivery_wait_seconds
        self._deliveries: asyncio.Queue = asyncio.Queue()  # Rails reports, heartbeats and the finish, in order
        self._delivery_task: asyncio.Task | None = None
        self._unheard_turns = 0  # candidate turns that ended but whose final transcript has not arrived
        self._turn_heard = asyncio.Event()
        self._tool_speeches: list[tuple] = []  # (speech handle, its step) of each tool call still speaking
        self._controller = LiveInterviewController()
        self._lock = asyncio.Lock()
        self._tasks: set[asyncio.Task] = set()
        self.finished = False  # Rails accepted the finish
        self._left = False
        self._reporter = LiveReporter(rails, connection_id, usage_totals=self.usage_totals, on_event=self._rails_event)

    def usage_totals(self) -> LiveUsageTotals:
        """The session's running provider usage so far."""
        return LiveUsageTotals.from_model_usage(
            self._session.usage.model_usage, realtime_model=REALTIME_MODEL, transcription_model=TRANSCRIPTION_MODEL)

    def _spawn(self, event: LiveEvent) -> None:
        task = asyncio.create_task(self.handle(event))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def on_agent_state_changed(self, event: AgentStateChangedEvent) -> None:
        """LiveKit callback: the interviewer is busy while thinking of or speaking a reply."""
        self._spawn(SpeakingChanged("interviewer", event.new_state in ("thinking", "speaking")))

    def on_user_state_changed(self, event: UserStateChangedEvent) -> None:
        """LiveKit callback: the candidate started or stopped speaking. A turn that ended still owes
        its final transcript, which the provider may send after the reply it prompted has started."""
        if event.old_state == "speaking" and event.new_state != "speaking":
            self._unheard_turns += 1
        self._spawn(SpeakingChanged("candidate", event.new_state == "speaking"))

    def on_participant_connected(self, participant: rtc.RemoteParticipant) -> None:
        """Room callback: the candidate (any participant that is not an agent) joined or rejoined."""
        if participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            self._spawn(CandidateJoined(self._clock()))

    def on_participant_disconnected(self, participant: rtc.RemoteParticipant) -> None:
        """Room callback: the candidate left; the controller waits for them to come back."""
        if participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            self._spawn(CandidateLeft(self._clock()))

    def on_session_close(self, event: CloseEvent) -> None:
        """LiveKit callback: the AgentSession closed. Our own leaving closes it too (job shutdown);
        otherwise LiveKit closed it on its own (an unrecoverable realtime error closes it in
        `AgentSession._on_error`, and the room stays), so nothing more can be said: save and finish."""
        if self._left:
            return
        logger.warning("Live AgentSession closed: %s %s", event.reason.value,
                       type(event.error).__name__ if event.error else "")
        reason = "disconnected" if event.reason == CloseReason.PARTICIPANT_DISCONNECTED else "failed"
        self._spawn(SessionClosed(reason))

    def on_conversation_item_added(self, event: ConversationItemAddedEvent) -> None:
        """LiveKit callback: final interviewer and candidate messages become controller events."""
        item = event.item
        if isinstance(item, llm.ChatMessage) and item.role == "assistant":
            self._spawn(InterviewerTurnFinished(item.text_content or "", preamble=self._spoken_before_a_tool_result(item)))
        elif isinstance(item, llm.ChatMessage) and item.role == "user":
            task = asyncio.create_task(self._candidate_turn_heard(item.text_content or ""))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    async def _candidate_turn_heard(self, text: str) -> None:
        """Hand the controller a final transcript, then let any tool call waiting for it go on."""
        await self.handle(CandidateTurnFinished(text))
        self._unheard_turns = max(self._unheard_turns - 1, 0)
        self._turn_heard.set()

    def _spoken_before_a_tool_result(self, item: llm.ChatMessage) -> bool:
        """Whether this interviewer message came from a model response that also called a tool.

        LiveKit runs a tool while its response is still generating and adds that response's
        spoken message only after it has played, so the message ("Sure, let's move on.") arrives
        after the tool event. The reply to the tool's result is spoken by the same SpeechHandle
        one step later (`num_steps` grows once the tools are done), or by a new speech, so a
        message recorded on the tool call's speech at the tool call's step is the preamble
        (livekit-agents `voice/agent_activity.py`, `_realtime_generation_task_impl`)."""
        return any(step == speech.num_steps and any(recorded is item for recorded in speech.chat_items)
                   for speech, step in self._tool_speeches)

    async def tool(self, event: ToolEvent, speech=None) -> str:
        """Run one tool call once the candidate's ended turns are transcribed (at most a few seconds).

        The tool's decision (save, follow up, move on) is about the answer the candidate just
        gave, so it waits for that answer's final transcript. If it does not come in time (the
        transcription failed), the call goes on with what was heard; words that arrive later still
        join the current answer, or are dropped while the next prompt is being asked.

        `speech` is the LiveKit SpeechHandle whose response called the tool; words it spoke at
        this step are a preamble, never the turn the result asks for."""
        if speech is not None:
            self._tool_speeches = [(handle, step) for handle, step in self._tool_speeches if not handle.done()]
            self._tool_speeches.append((speech, speech.num_steps))
        await self._wait_for_candidate_transcripts()
        return await self.handle(event) or ""

    async def _wait_for_candidate_transcripts(self) -> None:
        deadline = asyncio.get_running_loop().time() + self._transcript_wait_seconds
        while self._unheard_turns:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                logger.warning("Live candidate transcript did not arrive in time; the tool call goes on")
                self._unheard_turns = 0
                return
            self._turn_heard.clear()
            try:
                await asyncio.wait_for(self._turn_heard.wait(), remaining)
            except TimeoutError:
                pass

    async def handle(self, event: LiveEvent) -> str | None:
        """Carry out the event's actions; returns the tool result text for tool events."""
        async with self._lock:
            return await self._dispatch(event)

    async def tick_forever(self, seconds: float = 1.0) -> None:
        """Send the controller the clock about once a second until the interview finishes."""
        while not self._left:
            await asyncio.sleep(seconds)
            await self._keep_going("tick", Tick(self._clock()))

    async def heartbeat(self) -> None:
        """Ask the controller for a heartbeat now (the loop below does this about every 30 seconds)."""
        await self.handle(HeartbeatDue())

    async def heartbeat_forever(self, seconds: float = 30.0) -> None:
        while not self._left:
            await asyncio.sleep(seconds)
            await self._keep_going("heartbeat", HeartbeatDue())

    async def _keep_going(self, loop: str, event: LiveEvent) -> None:
        """One failed action must not stop the clock or the heartbeats (logged by type, never content)."""
        try:
            await self.handle(event)
        except Exception as error:  # noqa: BLE001 - the loop carries on with the next tick or heartbeat
            logger.warning("Live %s action failed: %s", loop, type(error).__name__)

    def _interrupt(self) -> None:
        """Stop the interviewer talking; a session LiveKit already closed has nothing to stop."""
        try:
            self._session.interrupt()
        except RuntimeError as error:
            logger.warning("Live interrupt skipped: %s", type(error).__name__)

    def _generate_reply(self, instructions: str):
        """Have the model speak; returns its SpeechHandle, or None once the session is closed."""
        try:
            return self._session.generate_reply(instructions=instructions)
        except RuntimeError as error:
            logger.warning("Live reply skipped: %s", type(error).__name__)
            return None

    async def choose(self, data: rtc.RpcInvocationData) -> str:
        """The room's `interview.choose` RPC: a menu button, "How was that?" or End interview."""
        try:
            option = json.loads(data.payload).get("option")
        except (ValueError, AttributeError):
            option = None
        if not isinstance(option, str) or option not in MENU_OPTIONS | {"end"}:
            raise rtc.RpcError(2001, "Unknown interview option")
        self._interrupt()
        if option in MENU_OPTIONS:
            await self.handle(MenuChoice(option))
            return "accepted"
        await self.handle(EndRequested())
        await self.delivered()  # the finish answers this choice
        if not self.finished and not self._reporter.ended:
            raise rtc.RpcError(2002, "The interview could not be finished")
        return "ended"

    async def _dispatch(self, event: LiveEvent, *, held_reports: list | None = None) -> str | None:
        """Carry out the controller's actions for `event`. With `held_reports`, interview reports are
        collected there for the reporter to send next instead of being sent now."""
        result = None
        for action in self._controller.handle(event):
            if isinstance(action, ToolResult):
                result = action.text
            elif held_reports is not None and isinstance(action, InterviewReport):
                held_reports.append(action)
            elif not self._reporter.ended or (isinstance(action, EndSession) and not self._left):
                await self._carry_out(action)
        return ENDED if self._reporter.ended and result is not None else result

    async def _rails_event(self, event: LiveEvent) -> list:
        """What a Rails answer means for the controller (a prompt's receipt, a refused answer, or the
        connection ended); returns the reports it raises, which the reporter sends next. Called by
        the delivery task, never while the lock is held."""
        if isinstance(event, ConnectionEnded):
            self._interrupt()  # the interviewer stops talking; the controller leaves
        held: list = []
        async with self._lock:
            await self._dispatch(event, held_reports=held)
        return held

    def _deliver(self, action) -> None:
        """Queue a report, heartbeat or finish for Rails behind the ones before it; never waits."""
        self._deliveries.put_nowait(action)
        if self._delivery_task is None:
            self._delivery_task = asyncio.create_task(self._deliver_forever())

    async def _deliver_forever(self) -> None:
        """The one task that talks to Rails, so reports, heartbeats and the finish keep their order."""
        while True:
            action = await self._deliveries.get()
            try:
                await self._deliver_one(action)
            except Exception as error:  # noqa: BLE001 - one failed delivery must not stop the rest
                logger.warning("Live delivery failed: %s", type(error).__name__)
            finally:
                self._deliveries.task_done()

    async def _deliver_one(self, action) -> None:
        if isinstance(action, SendHeartbeat):
            reply = await self._reporter.heartbeat(action)
            if reply is not None and not action.final:
                await self.handle(HeartbeatReplied(reply.action, reply.allowance_seconds_left, reply.reason))
        elif isinstance(action, ReportFinish):
            if not self._reporter.ended:  # Rails already ended it while this waited: nothing to finish
                self.finished = await self._reporter.finish(action)
        else:
            await self._reporter.send(action)

    async def delivered(self) -> None:
        """Wait (a bounded time) until everything queued for Rails so far has been delivered or given up."""
        try:
            await asyncio.wait_for(self._deliveries.join(), self._delivery_wait_seconds)
        except TimeoutError:
            logger.warning("Live reports were still on their way to Rails when the wait ended")

    def stop_delivering(self) -> None:
        """Job shutdown: stop the delivery task."""
        if self._delivery_task is not None:
            self._delivery_task.cancel()

    async def _leave_after_deliveries(self) -> None:
        await self.delivered()
        self._leave()

    async def _carry_out(self, action: LiveAction) -> None:
        if isinstance(action, GenerateReply):
            self._generate_reply(action.instructions)
        elif isinstance(action, SayClosing):
            speech = self._generate_reply(action.instructions)
            if speech is None:  # nothing can be said, so the closing is over
                self._spawn(ClosingSpoken())
            else:
                speech.add_done_callback(lambda _speech: self._spawn(ClosingSpoken()))
        elif isinstance(action, SendHeartbeat | ReportFinish | InterviewReport):
            self._deliver(action)
        elif isinstance(action, PublishRoomState):
            await self._room.local_participant.set_attributes({
                "cd.question_position": str(action.question_position),
                "cd.question_total": str(action.question_total),
                "cd.phase": action.phase,
                "cd.menu_offered": "true" if action.menu_offered else "false",
                "cd.seconds_left": str(action.seconds_left),
                "cd.time_warning": "true" if action.time_warning else "false",
            })
        elif isinstance(action, EndSession):
            self._left = True  # the clock and heartbeats stop; the finish goes out before the job ends
            task = asyncio.create_task(self._leave_after_deliveries())
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)


async def _finish_failed_start(rails, connection_id: str) -> None:
    """Tell Rails a claimed connection could not start, so it finishes the interview now."""
    try:
        await rails.finish(connection_id, reason="failed")
    except (RailsClientError, RailsTransportError) as error:
        logger.warning("Live interview failed start was not recorded: %s", type(error).__name__)


class LiveInterviewerAgent(Agent):
    """The realtime interviewer. Its tools only forward to the controller and return its answer."""

    def __init__(self, *, instructions: str, runner: LiveInterviewRunner):
        super().__init__(instructions=instructions)
        self._runner = runner

    @function_tool
    async def ask_follow_up(self, context: RunContext, question_text: str) -> str:
        """Ask one follow-up about the candidate's answer to the current question. Call this before
        you speak the follow-up; the result says whether to ask it or to move on instead.

        Args:
            question_text: The follow-up question you want to ask, in a few words.
        """
        return await self._runner.tool(AskFollowUp(question_text), context.speech_handle)

    @function_tool
    async def finish_answer(self, context: RunContext) -> str:
        """Record that the candidate has finished answering the current question or follow-up."""
        return await self._runner.tool(FinishAnswer(), context.speech_handle)

    @function_tool
    async def repeat_question(self, context: RunContext) -> str:
        """Use when the candidate asks to hear the current question or follow-up again."""
        return await self._runner.tool(RepeatQuestion(), context.speech_handle)

    @function_tool
    async def next_question(self, context: RunContext) -> str:
        """Move on from the current question when you have no more follow-ups for it. The result says
        which question to ask next, or how to close the interview after the last one."""
        return await self._runner.tool(NextQuestion(), context.speech_handle)

    @function_tool
    async def give_feedback(self, context: RunContext) -> str:
        """Use when the candidate asks how they did ("How was that?"). The result says how to give the
        quick feedback; the words you then speak are saved as the feedback."""
        return await self._runner.tool(GiveFeedback(), context.speech_handle)

    @function_tool
    async def offer_menu(self, context: RunContext) -> str:
        """Use when the candidate is done with the current question or asks what they can do next. The
        result says whether to give feedback first or which choices to offer."""
        return await self._runner.tool(OfferMenu(), context.speech_handle)

    @function_tool
    async def give_hint(self, context: RunContext) -> str:
        """Use when the candidate asks for a hint. The result says how to hint without giving an answer."""
        return await self._runner.tool(GiveHint(), context.speech_handle)

    @function_tool
    async def retry_question(self, context: RunContext) -> str:
        """Use when the candidate wants to try the whole question again. The result says whether a retry
        is left and what to ask."""
        return await self._runner.tool(RetryQuestion(), context.speech_handle)


async def run_live_interview(ctx, *, rails, read_inputs, make_session, clock=time.monotonic,
                             tick_seconds: float = 1.0, heartbeat_seconds: float = 30.0,
                             transcript_wait_seconds: float = TRANSCRIPT_WAIT_SECONDS, tracer=None) -> None:
    """Run one dispatched live interview job.

    `rails` is a RailsLiveInterviewClient, `read_inputs(interview_id=, user_id=, connection_id=)`
    loads LiveInterviewInputs, and `make_session(persona)` builds the AgentSession. `clock`,
    `tick_seconds` and `heartbeat_seconds` drive the controller's clock and heartbeats (tests pass
    a fake clock); `transcript_wait_seconds` bounds how long a tool call waits for a late final
    transcript. `tracer` makes the job's root span (the global tracer by default).

    The agent joins the room only after the claim and the input read succeed, so the browser never
    sees an interviewer that cannot start. A refused claim ends the job without joining. Anything
    that fails after a successful claim finishes the connection as `failed` before the job ends,
    so Rails closes the interview instead of leaving the candidate in a silent room.
    """
    ctx.add_shutdown_callback(rails.aclose)
    tracer = tracer or trace.get_tracer("live_interviews")
    span = claim = None
    try:
        dispatch = LiveDispatch.model_validate_json(ctx.job.metadata)
        span = tracer.start_span("live_interview.session", attributes={
            "interview_session_id": dispatch.interview_session_id, "live_connection_id": dispatch.live_connection_id})
        # LiveKit's session spans and our tasks join this trace.
        with trace.use_span(span, end_on_exit=False):
            claim = await rails.claim(dispatch.live_connection_id, room_name=ctx.job.room.name)
            if claim.interview_session_id != dispatch.interview_session_id:
                raise ValueError("Live claim belongs to another interview")
            inputs = await asyncio.to_thread(read_inputs, interview_id=claim.interview_session_id,
                                             user_id=claim.user_id, connection_id=claim.live_connection_id)
            instructions = build_live_instructions(inputs)
            await ctx.connect()
            session = make_session(inputs.setup.interviewer)
            runner = LiveInterviewRunner(session=session, rails=rails, connection_id=claim.live_connection_id,
                                         room=ctx.room, leave=lambda: ctx.shutdown(reason="live interview finished"),
                                         clock=clock, transcript_wait_seconds=transcript_wait_seconds)
            session.on("conversation_item_added", runner.on_conversation_item_added)
            session.on("agent_state_changed", runner.on_agent_state_changed)
            session.on("user_state_changed", runner.on_user_state_changed)
            session.on("close", runner.on_session_close)
            ctx.room.local_participant.register_rpc_method("interview.choose", runner.choose)
            ctx.room.on("participant_connected", runner.on_participant_connected)
            ctx.room.on("participant_disconnected", runner.on_participant_disconnected)
            await session.start(LiveInterviewerAgent(instructions=instructions, runner=runner), room=ctx.room,
                                record=False, room_options=room_io.RoomOptions(close_on_disconnect=False))
            if not any(participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT
                       for participant in ctx.room.remote_participants.values()):
                await runner.handle(CandidateLeft(clock()))  # a fresh agent in an emptied room waits for the candidate
            await runner.handle(Started(question_position=claim.current_question_position,
                                        question_total=claim.question_total, answer_cap=claim.answer_cap,
                                        session_seconds_left=claim.session_seconds_left,
                                        retry_count=claim.current_question_retry_count,
                                        heartbeat_sequence=claim.heartbeat_sequence,
                                        current_prompt_message_id=claim.current_prompt_message_id,
                                        current_prompt_kind=claim.current_prompt_kind,
                                        current_prompt_answered=claim.current_prompt_answered,
                                        answer_count=claim.current_question_answer_count,
                                        feedback_given=claim.current_question_feedback_given))
            background = [asyncio.create_task(runner.tick_forever(tick_seconds)),
                          asyncio.create_task(runner.heartbeat_forever(heartbeat_seconds))]
    except Exception as error:  # noqa: BLE001 - any start failure ends the job; a claimed one is finished first
        logger.warning("Live interview could not start: %s", type(error).__name__)
        if claim is not None:
            await _finish_failed_start(rails, claim.live_connection_id)
        if span is not None:
            span.set_status(trace.Status(trace.StatusCode.ERROR, type(error).__name__))
            span.end()
        ctx.shutdown(reason="live interview unavailable")
        return

    async def stop_and_record_cost() -> None:
        for task in background:
            task.cancel()
        runner.stop_delivering()
        cost = runner.usage_totals().cost_microdollars()
        span.set_attributes({"provider_cost_microdollars": cost, "operation.cost": cost / 1_000_000})
        span.end()

    ctx.add_shutdown_callback(stop_and_record_cost)
