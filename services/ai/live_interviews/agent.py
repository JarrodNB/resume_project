"""Connect one live interview's LiveKit room to the controller, the realtime model and Rails.

This is the LiveKit adapter: interview decisions live in live_interviews.controller and delivery
to Rails in live_interviews.reporter. It claims the connection and reads the inputs before it
joins the room, turns LiveKit callbacks (transcripts, tool calls, the `interview.choose` RPC,
speaking state, participants, the session closing) into controller events, and carries out the
controller's actions. It never records audio and never logs spoken text.

It also keeps the realtime model's conversation short: once a new question (or a retried one) has
been asked, every conversation item before that question's opening is deleted, so each reply reads
only the current question's turns instead of the whole interview (`_forget_turns_before`).

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
from openai.types.realtime.realtime_audio_config_input import NoiseReduction
from openai.types.realtime.realtime_audio_input_turn_detection import ServerVad
from opentelemetry import trace
from pydantic import BaseModel, ConfigDict

from live_interviews.controller import (
    AskFollowUp,
    CandidateJoined,
    CandidateLeft,
    CandidateTurnFinished,
    ChoiceIgnored,
    ClosingSpoken,
    ConnectionEnded,
    EndRequested,
    EndSession,
    FinishAnswer,
    ForgetEarlierTurns,
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
    ProgressNotSaved,
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
from live_interviews.instructions import build_live_instructions, live_question_blocks
from live_interviews.reporter import SERVER_ERROR_DELAYS, InterviewReport, LiveReporter
from live_interviews.settings import PERSONA_VOICES, REALTIME_MODEL, TRANSCRIPTION_MODEL
from live_interviews.usage import LiveUsageTotals
from prompts.live_interviewer_instructions import LIVE_INTERVIEWER_PROMPT_VERSION
from prompts.live_interviewer_turns import CHOSEN_IN_ROOM, ENDED
from telemetry.tracing import record_prompt_version

logger = logging.getLogger(__name__)


class LiveDispatch(BaseModel):
    """The job metadata Rails puts in the join token: identities only, never content."""

    model_config = ConfigDict(frozen=True, extra="forbid")
    interview_session_id: str
    live_connection_id: str


# The candidate's "Silence length" answer setting (Quick, Normal, Patient), which the browser
# publishes as this participant attribute: how long they stay quiet before their turn ends.
SILENCE_ATTRIBUTE = "cd.silence_seconds"
SILENCE_CHOICES_MS = {"1.5": 1_500, "2.5": 2_500, "4": 4_000}
DEFAULT_SILENCE_MS = 2_500  # Normal, until the browser says otherwise


def turn_detection(silence_ms: int) -> ServerVad:
    """End the candidate's turn after `silence_ms` of quiet; their speech interrupts the interviewer."""
    return ServerVad(type="server_vad", silence_duration_ms=silence_ms, create_response=True, interrupt_response=True)


def realtime_model_options(persona: str) -> dict:
    """Keyword arguments for `openai.realtime.RealtimeModel`: model, persona voice, turn detection,
    noise reduction and input transcription (for the candidate's captions).

    The candidate's turn ends after the quiet their "Silence length" setting chooses (Normal until
    the browser publishes it; `LiveInterviewRunner.use_silence_choice`). OpenAI's default (half a
    second) and semantic detection (which ends a turn as soon as a phrase sounds complete, e.g.
    "I had to use FullStory") both cut candidates off mid-answer. Far-field noise reduction filters room noise and
    the interviewer's own voice from laptop speakers before turn detection and transcription, so
    they don't count as the candidate talking."""
    return {
        "model": REALTIME_MODEL,
        "voice": PERSONA_VOICES[persona],
        "turn_detection": turn_detection(DEFAULT_SILENCE_MS),
        "input_audio_noise_reduction": NoiseReduction(type="far_field"),
        "input_audio_transcription": AudioTranscription(model=TRANSCRIPTION_MODEL),
    }


MENU_OPTIONS = frozenset({"retry", "next", "feedback"})
TRANSCRIPT_WAIT_SECONDS = 3.0  # how long a tool call waits for the candidate's late final transcript
# How long leaving (and End interview's RPC answer) waits for reports still on their way to Rails.
# The browser's End wait (LIVE_END_AGENT_TIMEOUT_MS in apps/web useLiveInterviewRoom.ts) must stay
# above it: LiveKit cancels this RPC handler at the caller's response timeout.
DELIVERY_WAIT_SECONDS = 30.0
ROOM_STATE_SLOW_SECONDS = 5.0  # a room state publish this slow is logged (and still awaited)
# How long forgetting earlier questions waits for the interviewer to be quiet (no reply or tool call
# in progress). If it never is, this question keeps them; the next question's opening tries again.
FORGET_WAIT_SECONDS = 60.0


class LiveInterviewRunner:
    """Feed one session's events to the controller and carry out its actions in order.

    Controller steps run one at a time under a lock, but nothing under it waits for Rails or for
    LiveKit's room attributes (a separate task publishes the newest room state): reports,
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
        self._interviewer_state = "initializing"  # LiveKit's agent state: thinking and speaking are busy
        self._quiet_changed = asyncio.Event()  # set when the agent state changes or a speech finishes
        self._forget_from: str | None = None  # the newest opening whose earlier turns are still to be deleted
        self._forget_task: asyncio.Task | None = None
        self._deliveries: asyncio.Queue = asyncio.Queue()  # Rails reports, heartbeats and the finish, in order
        self._delivery_task: asyncio.Task | None = None
        self._silence_ms = DEFAULT_SILENCE_MS  # the turn detection the realtime session uses now
        self.on_first_words = None  # called once, when the interviewer first starts speaking
        # The model hears the candidate only once a question has been asked (see `hear_the_candidate`).
        self._hearing = False
        self._session.input.set_audio_enabled(False)
        self._room_state_wanted: dict[str, str] | None = None  # the newest room state not yet published
        self._room_state_task: asyncio.Task | None = None
        self._unheard_turns = 0  # candidate turns that ended but whose final transcript has not arrived
        self._turn_heard = asyncio.Event()
        self._tool_speeches: list[tuple] = []  # (speech handle, its step) of each tool call still speaking
        self._cut_off_speeches: list = []  # speech handles a room choice interrupted, still finishing
        self._instructed_speeches: list = []  # speech handles of the turn instructions we gave
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
        if event.new_state == "speaking" and self.on_first_words is not None:
            first_words, self.on_first_words = self.on_first_words, None
            first_words()
        self._interviewer_state = event.new_state
        self._quiet_changed.set()
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
            self.use_silence_choice(participant)
            self._spawn(CandidateJoined(self._clock()))

    def use_silence_choice(self, participant) -> None:
        """Apply the candidate's "Silence length" setting from their participant attribute (when they
        join, and whenever they change it). Values outside the three choices are ignored."""
        if participant.kind == rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            return
        silence_ms = SILENCE_CHOICES_MS.get(participant.attributes.get(SILENCE_ATTRIBUTE, ""))
        if silence_ms is None or silence_ms == self._silence_ms:
            return
        try:
            self._session.llm.update_options(turn_detection=turn_detection(silence_ms))
            self._silence_ms = silence_ms
        except Exception as error:  # noqa: BLE001 - the interview goes on with the earlier setting
            logger.warning("Live silence setting not applied: %s", type(error).__name__)

    def hear_the_candidate(self) -> None:
        """Pass the candidate's microphone to the model, from the first room state past `asking`
        (the first question has been asked, or a resumed interview is past it) until the closing.

        Until then the model hears nothing. OpenAI answers each turn of the candidate's by itself,
        and before the first question it has no question to ask: a "hello" as the room opened got
        a made-up interview question, then the real opening on top of it. Audio before this point
        is dropped, so the candidate can't talk over the opening either."""
        self._session.input.set_audio_enabled(True)
        self._hearing = True

    def stop_hearing_the_candidate(self) -> None:
        """From the closing on, the model hears nothing: the goodbye is the last thing said, and a
        "thanks, bye" from the candidate doesn't get (and cost) another reply."""
        if self._hearing:
            self._session.input.set_audio_enabled(False)
            self._hearing = False

    def on_participant_attributes_changed(self, _changed: dict[str, str], participant) -> None:
        """Room callback: a participant's attributes changed; the candidate may have a new silence setting."""
        self.use_silence_choice(participant)

    def on_participant_disconnected(self, participant: rtc.RemoteParticipant) -> None:
        """Room callback: the candidate left; the controller waits for them to come back."""
        if participant.kind != rtc.ParticipantKind.PARTICIPANT_KIND_AGENT:
            self._spawn(CandidateLeft(self._clock()))

    def on_session_close(self, event: CloseEvent) -> None:
        """LiveKit callback: the AgentSession closed. Our own leaving closes it too (job shutdown).

        Only an unrecoverable model error (`CloseReason.ERROR`, closed in `AgentSession._on_error`
        while the room stays) finishes the interview, as `failed`. Any other close we did not cause,
        such as LiveKit shutting the job down when the agent's room connection drops or the room
        closes, leaves without finishing: the clock and heartbeats stop, reports already on their way
        are still delivered (a bounded wait), and the connection stays open so the candidate can
        rejoin or a fresh agent can take over. Rails' recovery ends it if nobody comes back."""
        if self._left:
            return
        logger.warning("Live AgentSession closed: %s %s", event.reason.value,
                       type(event.error).__name__ if event.error else "")
        if event.reason == CloseReason.ERROR:
            self._spawn(SessionClosed())
            return
        self._left = True
        task = asyncio.create_task(self._leave_after_deliveries())
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def on_conversation_item_added(self, event: ConversationItemAddedEvent) -> None:
        """LiveKit callback: final interviewer and candidate messages become controller events."""
        item = event.item
        if isinstance(item, llm.ChatMessage) and item.role == "assistant":
            if self._cut_off_by_a_choice(item):
                return
            self._spawn(InterviewerTurnFinished(item.text_content or "", preamble=self._spoken_before_a_tool_result(item),
                                                unprompted=not self._asked_for(item),
                                                interrupted=bool(getattr(item, "interrupted", False)),
                                                item_id=item.id))
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

    def _cut_off_by_a_choice(self, item: llm.ChatMessage) -> bool:
        """Whether this interviewer message belongs to a speech a room choice interrupted.

        LiveKit adds an interrupted speech's message (the words heard before the cut) only once
        its playout task has finished, after the choice already moved the interview on, so it
        would arrive as the turn the choice asked for (the feedback, the goodbye, the next
        question). Those words were never that turn and nothing of them is saved
        (livekit-agents `voice/agent_activity.py`, `_realtime_generation_task_impl`)."""
        return any(any(recorded is item for recorded in speech.chat_items) for speech in self._cut_off_speeches)

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
        async with self._lock:
            if any(speech is cut_off for cut_off in self._cut_off_speeches):
                return CHOSEN_IN_ROOM  # a room choice already replaced what this response was doing
            return await self._dispatch(event) or ""

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

    def _asked_for(self, item: llm.ChatMessage) -> bool:
        """Whether this interviewer message answers something we asked for: a turn instruction, or a
        response that called one of the interview tools (its reply to the tool's result). Anything
        else is a reply the model made on its own to the candidate's speech (OpenAI's server turn
        detection replies whenever a candidate turn ends), which never saw our instruction."""
        speeches = [*self._instructed_speeches, *(handle for handle, _step in self._tool_speeches)]
        return any(any(recorded is item for recorded in speech.chat_items) for speech in speeches)

    def _generate_reply(self, instructions: str):
        """Have the model speak; returns its SpeechHandle, or None once the session is closed."""
        try:
            speech = self._session.generate_reply(instructions=instructions)
        except RuntimeError as error:
            logger.warning("Live reply skipped: %s", type(error).__name__)
            return None
        self._instructed_speeches = [handle for handle in self._instructed_speeches if not handle.done()]
        self._instructed_speeches.append(speech)
        return speech

    async def choose(self, data: rtc.RpcInvocationData) -> str:
        """The room's `interview.choose` RPC: a menu button, "How was that?" or End interview.

        A button echoes the room state counter (`cd.state_seq`) the room showed for it. One from an
        older room state (the interview moved on by voice while the click was on its way) answers "ignored"
        and changes nothing: the interviewer keeps talking. Otherwise the choice cuts off the
        interviewer: whatever that speech had said is never taken as a turn, and a tool call its
        response made does nothing once it finishes."""
        try:
            choice = json.loads(data.payload)
            option = choice.get("option")
        except (ValueError, AttributeError):
            option = choice = None
        if not isinstance(option, str) or option not in MENU_OPTIONS | {"end"}:
            raise rtc.RpcError(2001, "Unknown interview option")
        if option in MENU_OPTIONS:
            state_seq = choice.get("state_seq")
            if not isinstance(state_seq, int) or isinstance(state_seq, bool):
                raise rtc.RpcError(2001, "Unknown interview option")
            async with self._lock:  # decided before anything is cut off, and in order with tool calls
                actions = self._controller.handle(MenuChoice(option, state_seq))
                if any(isinstance(action, ChoiceIgnored) for action in actions):
                    return "ignored"
                self._cut_off_the_interviewer()
                await self._carry_out_all(actions)
            return "accepted"
        self._cut_off_the_interviewer()
        await self.handle(EndRequested())
        await self.delivered()  # the finish answers this choice
        if not self.finished and not self._reporter.ended:
            raise rtc.RpcError(2002, "The interview could not be finished")
        return "ended"

    def _cut_off_the_interviewer(self) -> None:
        """Stop the interviewer for a room choice. `session.interrupt()` stops the speech playing and
        any response whose tool call is still running (LiveKit's background speeches,
        `AgentActivity.interrupt`); both are remembered so nothing they still produce counts."""
        self._cut_off_speeches = [handle for handle in self._cut_off_speeches if not handle.done()]
        speeches = [self._session.current_speech, *(handle for handle, _step in self._tool_speeches)]
        self._cut_off_speeches += [speech for speech in speeches if speech is not None and not speech.done()]
        self._interrupt()

    async def _dispatch(self, event: LiveEvent, *, held_reports: list | None = None) -> str | None:
        """Carry out the controller's actions for `event`. With `held_reports`, interview reports are
        collected there for the reporter to send next instead of being sent now."""
        return await self._carry_out_all(self._controller.handle(event), held_reports=held_reports)

    async def _carry_out_all(self, actions: list[LiveAction], *, held_reports: list | None = None) -> str | None:
        result = None
        for action in actions:
            if isinstance(action, ToolResult):
                result = action.text
            elif held_reports is not None and isinstance(action, InterviewReport):
                held_reports.append(action)
            elif not self._reporter.ended or (isinstance(action, EndSession) and not self._left):
                await self._carry_out(action)
        return ENDED if self._reporter.ended and result is not None else result

    async def _rails_event(self, event: LiveEvent) -> list:
        """What a Rails answer means for the controller (a prompt's receipt, a refused prompt, answer,
        advance or retry, or the connection ended); returns the reports it raises, which the reporter sends next. Called by
        the delivery task, never while the lock is held."""
        if isinstance(event, ConnectionEnded | ProgressNotSaved):
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
                await self.handle(HeartbeatReplied(reply.action, reply.reason))
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
        await self._room_state_published()
        self._leave()

    def _publish_room_state(self, attributes: dict[str, str]) -> None:
        """Show `attributes` in the room; never waits. LiveKit's `set_attributes` waits for its reply
        with no timeout, so a slow LiveKit must not hold the controller's lock (tools, choices, the
        clock and heartbeats need it). One task publishes, one state at a time, always the newest
        waiting: states in between are skipped, so the room never sees an older state after a newer one."""
        self._room_state_wanted = attributes
        if self._room_state_task is None or self._room_state_task.done():
            self._room_state_task = asyncio.create_task(self._publish_room_states())

    async def _publish_room_states(self) -> None:
        while self._room_state_wanted is not None:
            attributes, self._room_state_wanted = self._room_state_wanted, None
            publish = asyncio.ensure_future(self._room.local_participant.set_attributes(attributes))
            try:
                # Never cancelled: an abandoned request could still land after a newer one.
                done, _pending = await asyncio.wait({publish}, timeout=ROOM_STATE_SLOW_SECONDS)
                if not done:
                    logger.warning("Live room state is slow to publish; still waiting for LiveKit")
                await publish
            except Exception as error:  # noqa: BLE001 - the next state still goes out
                logger.warning("Live room state could not be published: %s", type(error).__name__)

    async def _room_state_published(self) -> None:
        """Wait (a bounded time) for the last room state, such as `ended`, to reach the room."""
        if self._room_state_task is not None and not self._room_state_task.done():
            done, _pending = await asyncio.wait({self._room_state_task}, timeout=self._delivery_wait_seconds)
            if not done:
                logger.warning("Live room state was still on its way when the wait ended")

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
            if action.phase in ("closing", "ended"):
                self.stop_hearing_the_candidate()
            elif not self._hearing and action.phase != "asking":
                self.hear_the_candidate()
            self._publish_room_state({
                "cd.question_position": str(action.question_position),
                "cd.question_total": str(action.question_total),
                "cd.phase": action.phase,
                "cd.state_seq": str(action.state_seq),
                "cd.menu_offered": "true" if action.menu_offered else "false",
                "cd.seconds_left": str(action.seconds_left),
                "cd.time_warning": "true" if action.time_warning else "false",
                "cd.answer_heard": "true" if action.answer_heard else "false",
            })
        elif isinstance(action, ForgetEarlierTurns):
            self._forget_turns_before(action.item_id)
        elif isinstance(action, EndSession):
            self._left = True  # the clock and heartbeats stop; the finish goes out before the job ends
            task = asyncio.create_task(self._leave_after_deliveries())
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)

    def _forget_turns_before(self, item_id: str) -> None:
        """Have the model forget everything said before the conversation item `item_id` (a new or
        retried question's opening), once the interviewer is quiet; never waits.

        Without this the realtime model re-reads the whole interview on every reply, so each reply
        costs more than the one before. The model needs only the current question: its opening,
        the answers, follow-ups, hints, feedback and menu that come after it. Rails keeps every
        saved turn and session feedback reads those, not the model's memory.

        Only one deletion runs at a time; a newer opening replaces one still waiting to be done."""
        self._forget_from = item_id
        if self._forget_task is None or self._forget_task.done():
            self._forget_task = asyncio.create_task(self._forget_when_quiet())

    async def _forget_when_quiet(self) -> None:
        while self._forget_from is not None and not self._left:
            quiet = await self._wait_until_quiet()
            item_id, self._forget_from = self._forget_from, None
            if item_id is None or self._left:
                return
            if not quiet:
                logger.warning("Live interviewer was never quiet; earlier questions stay in its conversation")
                continue
            try:
                await self._delete_items_before(item_id)
            except Exception as error:  # noqa: BLE001 - the interview goes on with the longer conversation
                logger.warning("Live earlier questions not forgotten: %s", type(error).__name__)

    def _interviewer_is_quiet(self) -> bool:
        """No reply is being thought of or spoken and no speech or tool call we know of is still
        running. LiveKit changes the realtime conversation itself only inside a speech (adding a
        tool's output, removing words an interruption cut off), so at a quiet moment nothing of
        LiveKit's is changing it and no response we started still needs its earlier items."""
        if self._interviewer_state in ("thinking", "speaking"):
            return False
        return not self._unfinished_speeches()

    def _unfinished_speeches(self) -> list:
        speeches = [self._session.current_speech, *self._instructed_speeches, *self._cut_off_speeches,
                    *(handle for handle, _step in self._tool_speeches)]
        return [speech for speech in speeches if speech is not None and not speech.done()]

    async def _wait_until_quiet(self) -> bool:
        """Wait (at most `FORGET_WAIT_SECONDS`) until the interviewer is quiet; False if it never was."""
        deadline = asyncio.get_running_loop().time() + FORGET_WAIT_SECONDS
        watched: set[int] = set()
        while not self._interviewer_is_quiet():
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                return False
            self._quiet_changed.clear()
            for speech in self._unfinished_speeches():
                if id(speech) not in watched:
                    watched.add(id(speech))
                    speech.add_done_callback(lambda _speech: self._quiet_changed.set())
            try:
                await asyncio.wait_for(self._quiet_changed.wait(), remaining)
            except TimeoutError:
                pass
        return True

    async def _delete_items_before(self, item_id: str) -> None:
        """Delete every item before `item_id` from the realtime conversation, keeping it and all after it.

        The new conversation is built from the realtime session's own copy of OpenAI's conversation
        (`RealtimeSession.chat_ctx`) minus the items before the opening, and handed to
        `Agent.update_chat_ctx`, LiveKit's way to change a running agent's conversation. Because
        every item it keeps is the server's own, LiveKit's sync (`compute_chat_ctx_diff`) sends only
        `conversation.item.delete` events for the dropped items: nothing is re-created or changed,
        and nothing after the opening, such as the candidate's answer still being heard, is touched.
        No await comes between reading that copy and LiveKit working out the deletions, so an item
        the server adds meanwhile is never mistaken for one to delete. The agent's own copy of the
        conversation is replaced too, so a later LiveKit sync from it can't bring the old items back.
        An item OpenAI refuses to delete is logged by LiveKit and the interview goes on."""
        agent = self._session.current_agent
        conversation = agent.realtime_llm_session.chat_ctx
        position = conversation.index_by_id(item_id)
        if position is None:
            logger.warning("Live opening not found in the realtime conversation; nothing forgotten")
            return
        if position == 0:
            return  # nothing came before it
        kept = llm.ChatContext(conversation.items[position:])
        await agent.update_chat_ctx(kept, exclude_invalid_function_calls=False)
        logger.info("Live interviewer forgot %d conversation items from before the current question", position)


async def _finish_failed_start(rails, connection_id: str) -> None:
    """Tell Rails a claimed connection could not start, so it finishes the interview now.

    It goes through the reporter, so it gets the same server-error retries as every finish: a 5xx
    is sent again twice after a short wait (Rails' 503 means "rolled back, send it again"). If it
    still fails, Rails' recovery finishes the connection once its heartbeat is overdue."""
    async def nothing_to_tell(_event) -> list:
        return []

    reporter = LiveReporter(rails, connection_id, usage_totals=LiveUsageTotals, on_event=nothing_to_tell,
                            server_error_delays=SERVER_ERROR_DELAYS)
    if not await reporter.finish(ReportFinish("failed")) and not reporter.ended:
        logger.warning("Live interview failed start was not recorded")


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
    tracer = tracer or trace.get_tracer("live_interviews")
    span = claim = None
    # How long each start-up step took, logged with the time to the interviewer's first words, so a
    # slow start shows where its seconds went. Real time, not `clock`, which tests fake.
    began, start_seconds = time.monotonic(), {}

    def step(name: str) -> None:
        start_seconds[name] = round(time.monotonic() - began - sum(start_seconds.values()), 2)

    try:
        dispatch = LiveDispatch.model_validate_json(ctx.job.metadata)
        with record_prompt_version(LIVE_INTERVIEWER_PROMPT_VERSION):  # framing and turn texts are one prompt
            span = tracer.start_span("live_interview.session", attributes={
                "interview_id": dispatch.interview_session_id, "live_connection_id": dispatch.live_connection_id})
        # LiveKit's session spans and our tasks join this trace.
        with trace.use_span(span, end_on_exit=False):
            claim = await rails.claim(dispatch.live_connection_id, room_name=ctx.job.room.name)
            step("claim")
            if claim.interview_session_id != dispatch.interview_session_id:
                raise ValueError("Live claim belongs to another interview")
            span.set_attributes({"user_id": claim.user_id, **({"ai_task_id": claim.ai_task_id} if claim.ai_task_id else {})})
            inputs = await asyncio.to_thread(read_inputs, interview_id=claim.interview_session_id,
                                             user_id=claim.user_id, connection_id=claim.live_connection_id)
            instructions = build_live_instructions(inputs)
            questions = live_question_blocks(inputs)
            if len(questions) < claim.question_total:  # the controller hands these out one at a time
                raise ValueError("Live interview is missing prepared questions")
            step("inputs")
            await ctx.connect()
            step("join_room")
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
            ctx.room.on("participant_attributes_changed", runner.on_participant_attributes_changed)
            await session.start(LiveInterviewerAgent(instructions=instructions, runner=runner), room=ctx.room,
                                record=False, room_options=room_io.RoomOptions(close_on_disconnect=False))
            step("start_session")

            def first_words() -> None:
                timings = {**start_seconds, "first_words": round(time.monotonic() - began, 2)}
                span.set_attributes({f"start_seconds.{name}": value for name, value in timings.items()})
                logger.info("Live interviewer first spoke %.1fs after the job started (%s)", timings["first_words"],
                            ", ".join(f"{name} {value}s" for name, value in start_seconds.items()))
            runner.on_first_words = first_words
            for participant in ctx.room.remote_participants.values():
                runner.use_silence_choice(participant)  # a candidate already here published it before we joined
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
                                        feedback_given=claim.current_question_feedback_given,
                                        questions=questions))
            background = [asyncio.create_task(runner.tick_forever(tick_seconds)),
                          asyncio.create_task(runner.heartbeat_forever(heartbeat_seconds))]
    except Exception as error:  # noqa: BLE001 - any start failure ends the job; a claimed one is finished first
        logger.warning("Live interview could not start: %s", type(error).__name__)
        if claim is not None:
            await _finish_failed_start(rails, claim.live_connection_id)
        if span is not None:
            span.set_status(trace.Status(trace.StatusCode.ERROR, type(error).__name__))
            span.end()
        ctx.add_shutdown_callback(rails.aclose)
        ctx.shutdown(reason="live interview unavailable")
        return

    async def stop_and_record_cost() -> None:
        for task in background:
            task.cancel()
        cost = runner.usage_totals().cost_microdollars()
        span.set_attributes({"provider_cost_microdollars": cost, "operation.cost": cost / 1_000_000})
        span.end()  # before any wait, so the tracing flush callback that runs beside this one sees it
        await runner.delivered()  # a shutdown we did not ask for still delivers what was queued (bounded)
        runner.stop_delivering()
        await rails.aclose()  # only now: shutdown callbacks run side by side

    ctx.add_shutdown_callback(stop_and_record_cost)
