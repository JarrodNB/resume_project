"""Smoke-test the LiveKit adapter with fake LiveKit, Rails and database stand-ins.

No LiveKit server, OpenAI or Rails is contacted: the session, room and clients are fakes.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from livekit import rtc
from livekit.agents import (
    AgentStateChangedEvent,
    CloseEvent,
    ConversationItemAddedEvent,
    UserStateChangedEvent,
    llm,
)
from livekit.agents.metrics import LLMModelUsage
from livekit.agents.voice.events import CloseReason
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import live_interviews.controller as live_controller
from database.live_interview_inputs import LiveInterviewInputs
from live_interviews.agent import LiveDispatch, realtime_model_options, run_live_interview
from live_interviews.client import (
    HeartbeatReply,
    LiveConnectionClaim,
    LiveConnectionEnded,
    RailsClientError,
    RailsTransportError,
)
from live_interviews.settings import AGENT_NAME, PERSONA_VOICES
from privacy.known_contact import KnownContact
from prompts.live_interviewer_instructions import LIVE_INTERVIEWER_PROMPT_VERSION
from schemas.interview_setup import InterviewSetup
from telemetry.privacy import ContactSpanProcessor

METADATA = '{"interview_session_id": "session", "live_connection_id": "live"}'
CLAIM = LiveConnectionClaim(interview_session_id="session", live_connection_id="live", user_id="owner", ai_task_id="task",
                            question_total=2, current_question_position=0, answer_cap=2, session_seconds_left=1_500)

@pytest.fixture(autouse=True)
def short_answer_check_off(monkeypatch):
    """Most tests answer with short placeholder words, so the "still answering" check is off unless a
    test turns it back on with `REAL_SHORT_ANSWER_WORDS`."""
    monkeypatch.setattr(live_controller, "SHORT_ANSWER_WORDS", {"opening": 0, "follow_up": 0})



class FakeParticipant:
    def __init__(self):
        self.attributes, self.rpc_methods, self.fail_next = [], {}, False
        self.hold: asyncio.Event | None = None

    async def set_attributes(self, attributes):
        if self.hold is not None:  # LiveKit is slow to answer: this publish waits until released
            await self.hold.wait()
        if self.fail_next:
            self.fail_next = False
            raise ConnectionError("room unavailable")
        self.attributes.append(attributes)

    def register_rpc_method(self, method_name, handler):
        self.rpc_methods[method_name] = handler


class FakeRoom:
    name = ""  # LiveKit fills the room's name only once the agent has joined

    def __init__(self):
        self.local_participant, self.handlers = FakeParticipant(), {}
        self.remote_participants = {"user-owner": candidate()}

    def on(self, event, handler):
        self.handlers[event] = handler

    def emit(self, event, *arguments):
        self.handlers[event](*arguments)


def candidate(**attributes):
    return SimpleNamespace(identity="user-owner", kind=rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD,
                           attributes=attributes)


class FakeRealtimeModel:
    def __init__(self):
        self.turn_detections = []

    def update_options(self, *, turn_detection):
        self.turn_detections.append(turn_detection)


class FakeJob:
    metadata = METADATA
    room = SimpleNamespace(name="interview-session-room")  # the dispatched room, known before joining


class FakeContext:
    def __init__(self):
        self.job, self.room = FakeJob(), FakeRoom()
        self.connected, self.shutdown_callbacks, self.shutdown_reason = False, [], None

    async def connect(self):
        self.connected = True
        self.room.name = self.job.room.name

    def add_shutdown_callback(self, callback):
        self.shutdown_callbacks.append(callback)

    def shutdown(self, reason=""):
        self.shutdown_reason = reason


class FakeSpeechHandle:
    def __init__(self):
        self.callbacks, self.chat_items, self.finished = [], [], False

    def done(self):
        return self.finished

    def add_done_callback(self, callback):
        self.callbacks.append(callback)

    def finish(self):
        self.finished = True
        for callback in self.callbacks:
            callback(self)


class FakeToolSpeech:
    """The speech whose model response called a tool: LiveKit's SpeechHandle records every chat
    item of that response, and counts a step for each tool round."""

    def __init__(self):
        self.chat_items, self.num_steps = [], 1

    def done(self):
        return False


def tool_call(speech=None):
    """The RunContext LiveKit passes a tool: only its speech handle is used."""
    return SimpleNamespace(speech_handle=speech or FakeToolSpeech())


class FakeAgentInput:
    """AgentSession.input: records each time the candidate's microphone is passed on or held back."""

    def __init__(self):
        self.audio_enabled_calls = []

    def set_audio_enabled(self, enabled):
        self.audio_enabled_calls.append(enabled)


class FakeSession:
    def __init__(self):
        self.handlers, self.replies, self.started, self.agent, self.interrupted = {}, [], None, None, 0
        self.handles, self.model_usage, self.closed = [], [], False
        self.current_speech = None  # the SpeechHandle playing now, as LiveKit's AgentSession.current_speech
        self.llm = FakeRealtimeModel()
        self.input = FakeAgentInput()

    @property
    def usage(self):
        return SimpleNamespace(model_usage=list(self.model_usage))

    def on(self, event, handler):
        self.handlers[event] = handler

    async def start(self, agent, *, room, record, room_options):
        self.agent = agent
        self.started = {"instructions": agent.instructions, "room": room, "record": record,
                        "close_on_disconnect": room_options.close_on_disconnect}

    def interrupt(self):
        if self.closed:
            raise RuntimeError("AgentSession isn't running")
        self.interrupted += 1

    def generate_reply(self, *, instructions):
        if self.closed:
            raise RuntimeError("AgentSession isn't running")
        self.replies.append(instructions)
        self.handles.append(FakeSpeechHandle())
        return self.handles[-1]

    def emit_item(self, role, text, speech=None, *, unprompted=False, interrupted=False):
        """Announce a final message. An interviewer message belongs to the last reply we asked for
        unless `speech` names another one, or `unprompted` makes it the model's own reply."""
        item = llm.ChatMessage(role=role, content=[text], interrupted=interrupted)
        if role == "assistant" and speech is None and not unprompted and self.handles:
            speech = self.handles[-1]
        if speech is not None:  # LiveKit records the item on its speech just before announcing it
            speech.chat_items.append(item)
        self.handlers["conversation_item_added"](ConversationItemAddedEvent(item=item))

    def close(self, reason=CloseReason.ERROR):
        """LiveKit closes the session on its own (as `AgentSession._on_error` does on an
        unrecoverable realtime error): later speech calls raise, then "close" is emitted."""
        self.closed = True
        self.handlers["close"](CloseEvent(reason=reason))

    def candidate_stops_speaking(self):
        """The provider heard the end of a candidate turn; its final transcript comes later."""
        self.handlers["user_state_changed"](UserStateChangedEvent(old_state="speaking", new_state="listening"))


class FakeRails:
    def __init__(self, claim=CLAIM, refuse=False):
        self.claim_result, self.refuse, self.calls, self.closed = claim, refuse, [], False
        self.refuse_finish = self.refuse_heartbeat = self.ended = False
        self.heartbeat_error = None
        self.lose, self.refuse_reports = {}, set()  # call name -> answers still to lose; names to refuse
        self.holds = {}  # call name -> an asyncio.Event the call waits for (Rails is slow or never answers)
        self.heartbeat_reply = HeartbeatReply(action="continue", session_seconds_left=1_400)

    async def claim(self, connection_id, *, room_name):
        self.calls.append(("claim", connection_id, room_name))
        if self.refuse:
            raise RailsClientError(409)
        return self.claim_result

    async def prompt_asked(self, connection_id, **values):
        self.calls.append(("prompt_asked", connection_id, values))
        await self._wait_if_held("prompt_asked")
        self._refuse_if_ended()
        self._lose_or_refuse("prompt_asked")
        position = values["question_position"]
        return {"message_id": f"{values['kind']}-{position}", "question_position": position, "revision": 2}

    async def answer_finished(self, connection_id, **values):
        self.calls.append(("answer_finished", connection_id, values))
        self._refuse_if_ended()
        self._lose_or_refuse("answer_finished")
        return {"message_id": "answer", "question_position": 0, "accepted_answer_count": 1, "revision": 3}

    async def question_advanced(self, connection_id, **values):
        self.calls.append(("question_advanced", connection_id, values))
        self._refuse_if_ended()
        self._lose_or_refuse("question_advanced")
        return {"current_question_position": values["question_position"] + 1, "revision": 4}

    async def feedback_given(self, connection_id, **values):
        self.calls.append(("feedback_given", connection_id, values))
        self._refuse_if_ended()
        self._lose_or_refuse("feedback_given")
        return {"question_position": values["question_position"], "revision": 6}

    async def question_retried(self, connection_id, **values):
        self.calls.append(("question_retried", connection_id, values))
        self._refuse_if_ended()
        self._lose_or_refuse("question_retried")
        return {"question_position": values["question_position"], "retry_count": values["retry_number"], "revision": 7}

    async def heartbeat(self, connection_id, **values):
        self.calls.append(("heartbeat", connection_id, values))
        await self._wait_if_held("heartbeat")
        self._refuse_if_ended()
        if self.refuse_heartbeat:
            raise RailsTransportError("lost")
        if self.heartbeat_error:
            raise self.heartbeat_error
        return self.heartbeat_reply

    async def finish(self, connection_id, **values):
        self.calls.append(("finish", connection_id, values))
        self._refuse_if_ended()
        if self.refuse_finish:
            raise RailsClientError(409)
        return {"status": "completed", "end_reason": values["reason"], "revision": 5}

    async def aclose(self):
        self.closed = True

    async def _wait_if_held(self, name):
        if name in self.holds:
            await self.holds[name].wait()
        if self.closed:  # the HTTP client was closed while this call waited
            raise RailsTransportError("client closed")

    def _lose_or_refuse(self, name):
        if self.lose.get(name):
            self.lose[name] -= 1
            raise RailsTransportError("lost")  # Rails may or may not have saved it
        if name in self.refuse_reports:
            raise RailsClientError(422, None)  # a definite no: stale

    def _refuse_if_ended(self):
        if self.ended:  # recovery or the owner ended the connection
            raise LiveConnectionEnded(409, "connection_ended")


def fake_inputs(**ids):
    assert ids == {"interview_id": "session", "user_id": "owner", "connection_id": "live"}
    return LiveInterviewInputs(setup=InterviewSetup(question_count=5, interviewer="priya"),
                               questions=tuple(f"Prepared question {number}?" for number in range(1, 9)),
                               contact=KnownContact())


async def settle():
    """Let callbacks, the clock and the Rails delivery task run."""
    for _ in range(20):
        await asyncio.sleep(0)


def run_interview(rails, sessions, **options):
    ctx = FakeContext()

    def make_session(persona):
        session = FakeSession()
        sessions.append((persona, session))
        return session

    async def go():
        await run_live_interview(ctx, rails=rails, read_inputs=fake_inputs, make_session=make_session, **options)
        await settle()
        return ctx

    return ctx, go


def test_claims_loads_instructions_greets_and_reports_the_spoken_opening():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        persona, session = sessions[0]
        assert persona == "priya"
        assert session.started["record"] is False and session.started["room"] is ctx.room
        assert session.started["close_on_disconnect"] is False  # a dropped candidate can come back
        # The session instructions hold no questions: each one comes with the turn that asks it.
        assert "Prepared question" not in session.started["instructions"]
        assert "question 1" in session.replies[0].lower() and "Prepared question 1?" in session.replies[0]
        assert "Prepared question 2?" not in session.replies[0]
        assert ctx.room.local_participant.attributes[0] == {
            "cd.question_position": "0", "cd.question_total": "2", "cd.phase": "asking", "cd.state_seq": "1",
            "cd.menu_offered": "false", "cd.seconds_left": "1500", "cd.time_warning": "false",
            "cd.answer_heard": "false"}
        session.emit_item("user", "Hello?")
        session.emit_item("assistant", "Welcome. First, tell me about a project.")
        await settle()
        session.emit_item("assistant", "Take your time.")
        await settle()

    asyncio.run(scenario())
    assert ctx.connected
    assert rails.calls == [
        ("claim", "live", "interview-session-room"),
        ("prompt_asked", "live", {"question_position": 0, "kind": "opening",
                                  "text": "Welcome. First, tell me about a project."}),
    ]
    assert ctx.room.local_participant.attributes[-1]["cd.phase"] == "answering"


def shown_seq(ctx):
    """The room state counter the browser shows now (the agent's latest `cd.state_seq`)."""
    return int(ctx.room.local_participant.attributes[-1]["cd.state_seq"])


def rpc(option, state_seq=None):
    """An `interview.choose` call; a button echoes the room state counter it was shown with."""
    payload = {"option": option}
    if state_seq is not None:
        payload |= {"state_seq": state_seq}
    return SimpleNamespace(request_id="r", caller_identity="user-owner", payload=json.dumps(payload),
                           response_timeout=5.0, method="interview.choose")


def test_tools_and_candidate_speech_drive_rails_through_a_whole_interview():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        agent = session.agent
        assert {tool.info.name for tool in agent.tools} == {"ask_follow_up", "finish_answer", "repeat_question",
                                                            "next_question", "give_feedback", "offer_menu",
                                                            "give_hint", "retry_question"}
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        assert "follow-up" in (await agent.ask_follow_up(tool_call(), "What changed?")).lower()
        session.emit_item("assistant", "What changed for the team?")
        await settle()
        session.emit_item("user", "Fewer failed runs.")
        await settle()
        assert "Quick feedback:" in await agent.ask_follow_up(tool_call(), "Anything else?")  # the cap is reached
        session.emit_item("assistant", "Quick feedback: clear story. Lead with the result.")
        await settle()
        assert ctx.room.local_participant.attributes[-1] == {
            "cd.question_position": "0", "cd.question_total": "2", "cd.phase": "menu", "cd.state_seq": "8",
            "cd.menu_offered": "true", "cd.seconds_left": "1500", "cd.time_warning": "false",
            "cd.answer_heard": "false"}
        assert "move on" in session.replies[-1].lower()  # the menu is offered
        assert "only two choices" in (await agent.give_hint(tool_call())).lower()  # no hint after feedback
        assert "only two choices" in (await agent.repeat_question(tool_call())).lower()
        assert "question 1" in (await agent.retry_question(tool_call())).lower()
        session.emit_item("assistant", "Let's try again: tell me about a project.")
        await settle()
        session.emit_item("user", "A sharper answer.")
        await settle()
        assert "Quick feedback:" in await agent.offer_menu(tool_call())
        session.emit_item("assistant", "Quick feedback: much sharper.")
        await settle()
        assert "question 2" in (await agent.next_question(tool_call())).lower()
        session.emit_item("assistant", "Next question: how do you handle conflict?")
        await settle()
        assert "thank" in (await agent.next_question(tool_call())).lower()
        session.emit_item("assistant", "Thank you, goodbye!")
        await settle()

    asyncio.run(scenario())
    assert rails.calls[1:] == [
        ("prompt_asked", "live", {"question_position": 0, "kind": "opening", "text": "Tell me about a project."}),
        ("answer_finished", "live", {"prompt_message_id": "opening-0", "transcript": "I rebuilt the scheduler."}),
        ("prompt_asked", "live", {"question_position": 0, "kind": "follow_up", "text": "What changed for the team?",
                                  "prompt_key": "q0-r0-f1"}),
        ("answer_finished", "live", {"prompt_message_id": "follow_up-0", "transcript": "Fewer failed runs."}),
        ("feedback_given", "live", {"question_position": 0, "text": "Quick feedback: clear story. Lead with the result."}),
        ("question_retried", "live", {"question_position": 0, "retry_number": 1}),
        ("prompt_asked", "live", {"question_position": 0, "kind": "opening",
                                  "text": "Let's try again: tell me about a project."}),
        ("answer_finished", "live", {"prompt_message_id": "opening-0", "transcript": "A sharper answer."}),
        ("feedback_given", "live", {"question_position": 0, "text": "Quick feedback: much sharper."}),
        ("question_advanced", "live", {"question_position": 0}),
        ("prompt_asked", "live", {"question_position": 1, "kind": "opening",
                                  "text": "Next question: how do you handle conflict?"}),
        ("question_advanced", "live", {"question_position": 1}),
        ("heartbeat", "live", {"sequence": 1, "billed_seconds_delta": 0, "usage": []}),
        ("finish", "live", {"reason": "completed", "final_sequence": 1}),
    ]
    assert ctx.room.local_participant.attributes[-1]["cd.phase"] == "ended"
    assert ctx.shutdown_reason


def test_menu_buttons_interrupt_and_have_the_interviewer_speak_the_choice():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        choose = ctx.room.local_participant.rpc_methods["interview.choose"]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        assert await choose(rpc("feedback", shown_seq(ctx))) == "accepted"
        assert session.interrupted == 1 and "answer so far" in session.replies[-1]
        session.emit_item("assistant", "Quick feedback: good start.")
        await settle()
        await session.agent.next_question(tool_call())
        session.emit_item("assistant", "Quick feedback: clear.")
        await settle()
        with pytest.raises(rtc.RpcError):  # after feedback the only buttons are Try again and Move on
            await choose(rpc("hint", shown_seq(ctx)))
        assert await choose(rpc("next", shown_seq(ctx))) == "accepted"
        assert "question 2" in session.replies[-1].lower()

    asyncio.run(scenario())
    assert ("question_advanced", "live", {"question_position": 0}) in rails.calls


def test_words_cut_off_by_a_room_choice_never_count_as_the_turn_the_choice_asked_for():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        choose = ctx.room.local_participant.rpc_methods["interview.choose"]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        chatter = session.current_speech = FakeToolSpeech()  # the interviewer is mid-sentence
        assert await choose(rpc("feedback", shown_seq(ctx))) == "accepted"
        session.current_speech = None
        # LiveKit adds the cut-off message only after its playout task ends, after the choice ran.
        session.emit_item("assistant", "Mm, and what happened", speech=chatter)
        await settle()
        session.emit_item("assistant", "Quick feedback: good start.")
        await settle()

    asyncio.run(scenario())
    assert [call for call in rails.calls if call[0] == "feedback_given"] == [
        ("feedback_given", "live", {"question_position": 0, "text": "Quick feedback: good start."})]


def test_a_stale_room_button_neither_moves_the_interview_nor_cuts_off_the_interviewer():
    """The candidate said "move on" and clicked Move on: the voice got there first. The click,
    for question 1's menu, is ignored without skipping question 2 or silencing its asking."""
    rails, sessions = FakeRails(claim=CLAIM.model_copy(update={"question_total": 3})), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        choose = ctx.room.local_participant.rpc_methods["interview.choose"]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        await session.agent.next_question(tool_call())
        session.emit_item("assistant", "Quick feedback: clear.")
        await settle()
        menu = shown_seq(ctx)
        asking = FakeToolSpeech()
        await session.agent.next_question(tool_call(asking))  # "move on", said out loud
        asking.num_steps += 1  # the tool's result is in: its reply asks question 2
        session.current_speech = asking
        replies = len(session.replies)
        assert await choose(rpc("next", menu)) == "ignored"
        assert session.interrupted == 0 and len(session.replies) == replies
        session.current_speech = None
        session.emit_item("assistant", "Tell me about a conflict.", speech=asking)
        await settle()

    asyncio.run(scenario())
    assert [call for call in rails.calls if call[0] == "question_advanced"] == [
        ("question_advanced", "live", {"question_position": 0})]
    assert ("prompt_asked", "live", {"question_position": 1, "kind": "opening",
                                     "text": "Tell me about a conflict."}) in rails.calls


def test_a_tool_call_from_a_response_a_room_button_cut_off_is_not_carried_out():
    """At the menu the model calls next_question for "move on" while the candidate clicks Try again.
    The click cut that response off, so its tool call, finishing afterwards, changes nothing."""
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions, transcript_wait_seconds=5)

    async def scenario():
        await go()
        session = sessions[0][1]
        choose = ctx.room.local_participant.rpc_methods["interview.choose"]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        await session.agent.next_question(tool_call())
        session.emit_item("assistant", "Quick feedback: clear.")
        await settle()
        session.candidate_stops_speaking()  # "let's move on"; its transcript is still on its way
        moving_on = FakeToolSpeech()
        tool = asyncio.create_task(session.agent.next_question(tool_call(moving_on)))
        await settle()
        assert await choose(rpc("retry", shown_seq(ctx))) == "accepted"  # the preamble already played
        session.emit_item("user", "Let's move on.")
        assert "not done" in (await tool).lower()
        session.emit_item("assistant", "Tell me about a project, again.")
        await settle()

    asyncio.run(scenario())
    assert not any(call[0] == "question_advanced" for call in rails.calls)
    assert ("question_retried", "live", {"question_position": 0, "retry_number": 1}) in rails.calls


def test_move_on_while_the_menu_is_spoken_on_the_last_question_still_says_goodbye():
    rails, sessions = FakeRails(claim=CLAIM.model_copy(update={"question_total": 1})), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        choose = ctx.room.local_participant.rpc_methods["interview.choose"]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        await session.agent.next_question(tool_call())
        session.emit_item("assistant", "Quick feedback: clear story.")
        await settle()
        menu = session.current_speech = FakeToolSpeech()  # the menu sentence is playing
        assert await choose(rpc("next", shown_seq(ctx))) == "accepted"
        session.current_speech = None
        session.emit_item("assistant", "You can retry, hear", speech=menu)
        await settle()
        assert not any(call[0] == "finish" for call in rails.calls)  # the goodbye is still to come
        assert ctx.room.local_participant.attributes[-1]["cd.phase"] == "closing"
        session.emit_item("assistant", "Thank you. Goodbye!")
        await settle()

    asyncio.run(scenario())
    assert rails.calls[-1] == ("finish", "live", {"reason": "completed", "final_sequence": 1})
    assert ctx.shutdown_reason


def test_the_clock_nudges_a_long_answer_once():
    rails, sessions = FakeRails(), []
    now = [0.0]
    _ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        replies = len(session.replies)
        now[0] = 300.0
        await settle()
        assert len(session.replies) == replies + 1 and "wrap" in session.replies[-1].lower()

    asyncio.run(scenario())


def test_the_end_option_finishes_for_the_candidate_and_unknown_options_are_errors():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        choose = ctx.room.local_participant.rpc_methods["interview.choose"]
        with pytest.raises(rtc.RpcError):
            await choose(rpc("dance"))
        with pytest.raises(rtc.RpcError):
            await choose(rpc(["retry"]))
        with pytest.raises(rtc.RpcError):
            await choose(SimpleNamespace(payload="not json"))
        with pytest.raises(rtc.RpcError):  # a button echoes the room state it was shown with
            await choose(rpc("retry"))
        with pytest.raises(rtc.RpcError):
            await choose(rpc("retry", True))
        assert await choose(rpc("end")) == "ended"
        assert sessions[0][1].interrupted == 1
        await settle()  # leaving waits for the last room state to be published

    asyncio.run(scenario())
    assert rails.calls[-1] == ("finish", "live", {"reason": "ended_by_candidate", "final_sequence": 1})
    assert ctx.shutdown_reason


def test_a_refused_finish_is_an_rpc_error_so_the_browser_finishes_through_rails():
    rails, sessions = FakeRails(), []
    rails.refuse_finish = True
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        with pytest.raises(rtc.RpcError):
            await ctx.room.local_participant.rpc_methods["interview.choose"](rpc("end"))

    asyncio.run(scenario())


def test_a_refused_claim_ends_the_job_without_joining_the_room_or_starting_a_session():
    rails, sessions = FakeRails(refuse=True), []
    ctx, go = run_interview(rails, sessions)
    asyncio.run(go())
    assert sessions == [] and ctx.shutdown_reason and not ctx.connected
    assert rails.calls == [("claim", "live", "interview-session-room")]


def test_the_agent_joins_the_room_only_after_the_claim_and_inputs_are_read():
    rails, ctx = FakeRails(), FakeContext()
    seen = []

    def read_inputs(**ids):
        seen.append(ctx.connected)
        return fake_inputs(**ids)

    async def scenario():
        await run_live_interview(ctx, rails=rails, read_inputs=read_inputs, make_session=lambda persona: FakeSession())
        await settle()

    asyncio.run(scenario())
    assert seen == [False] and ctx.connected


def test_a_failure_after_the_claim_finishes_the_connection_as_failed_before_leaving():
    """The browser would otherwise wait in a room no interviewer ever joins."""
    def unreadable(**ids):
        raise ValueError("inputs changed")

    def broken_session(persona):
        session = FakeSession()

        async def start(*args, **kwargs):
            raise RuntimeError("realtime model unavailable")
        session.start = start
        return session

    for read_inputs, make_session, joined in ((unreadable, lambda persona: FakeSession(), False),
                                              (fake_inputs, broken_session, True)):
        rails, ctx = FakeRails(), FakeContext()
        asyncio.run(run_live_interview(ctx, rails=rails, read_inputs=read_inputs, make_session=make_session))
        assert ctx.connected is joined and ctx.shutdown_reason
        assert rails.calls == [("claim", "live", "interview-session-room"),
                               ("finish", "live", {"reason": "failed", "final_sequence": None})]  # no heartbeat was sent


def test_a_failed_start_finish_rails_answers_with_a_503_is_sent_again(monkeypatch):
    """Rails' 503 means "rolled back, send it again"; a lost finish would leave a silent room until recovery."""
    monkeypatch.setattr("live_interviews.agent.SERVER_ERROR_DELAYS", (0, 0))
    rails, ctx = FakeRails(), FakeContext()
    busy = [2]
    real_finish = rails.finish

    async def finish(connection_id, **values):
        if busy[0]:
            busy[0] -= 1
            rails.calls.append(("finish", connection_id, values))
            raise RailsClientError(503, None)
        return await real_finish(connection_id, **values)

    rails.finish = finish

    def unreadable(**ids):
        raise ValueError("inputs changed")

    asyncio.run(run_live_interview(ctx, rails=rails, read_inputs=unreadable, make_session=lambda persona: FakeSession()))
    assert rails.calls == [("claim", "live", "interview-session-room")] + [("finish", "live", {"reason": "failed", "final_sequence": None})] * 3


def test_dispatch_metadata_holds_only_the_two_ids():
    assert LiveDispatch.model_validate_json(METADATA) == LiveDispatch(interview_session_id="session",
                                                                       live_connection_id="live")
    with pytest.raises(ValueError):
        LiveDispatch.model_validate_json('{"interview_session_id": "s", "live_connection_id": "l", "text": "x"}')


def test_realtime_options_use_the_persona_voice_patient_turn_detection_and_transcription():
    options = realtime_model_options("daniel")
    assert options["model"] == "gpt-realtime-2.1-mini"
    assert options["voice"] == "cedar"
    # Half a second of silence, or semantic detection, cut candidates off mid-sentence. Normal
    # (2.5 seconds) applies until the candidate's own setting arrives.
    detection = options["turn_detection"]
    assert (detection.type, detection.silence_duration_ms) == ("server_vad", 2_500)
    assert options["input_audio_noise_reduction"].type == "far_field"
    assert options["input_audio_transcription"].model == "gpt-live-transcribe"
    assert PERSONA_VOICES == {"maya": "marin", "daniel": "cedar", "priya": "shimmer"}
    # Rails dispatches this exact name (services/api/spec/services/interviews/join_live_service_spec.rb).
    assert AGENT_NAME == "careerdrafter-live-interviewer"


def realtime_usage(input_audio_tokens):
    return LLMModelUsage(provider="api.openai.com", model="gpt-realtime-2.1-mini", input_tokens=input_audio_tokens,
                         input_audio_tokens=input_audio_tokens)


def test_a_heartbeat_refused_as_connection_ended_stops_speaking_and_leaves_without_finishing():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        rails.ended = True
        await session.agent._runner.heartbeat()
        await settle()
        assert session.interrupted == 1
        assert ctx.shutdown_reason
        replies = len(session.replies)
        assert "ended" in (await session.agent.next_question(tool_call())).lower()
        assert len(session.replies) == replies

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "heartbeat"]




def test_a_report_refused_as_connection_ended_leaves_and_skips_the_rest():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        rails.ended = True
        assert "Quick feedback" in await session.agent.next_question(tool_call())  # never waits for Rails
        await settle()  # the answer save is then refused: the interviewer stops and leaves
        assert ctx.shutdown_reason and session.interrupted == 1
        assert "ended" in (await session.agent.next_question(tool_call())).lower()

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "prompt_asked", "answer_finished"]


def test_an_advance_rails_refuses_stops_speaking_and_finishes_as_failed_without_more_reports():
    rails, sessions = FakeRails(), []
    rails.refuse_reports.add("question_advanced")
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        await session.agent.next_question(tool_call())  # no answer: straight on to question 2
        await settle()
        session.emit_item("assistant", "Next: how do you handle conflict?")  # Rails would refuse it
        await settle()
        assert ctx.shutdown_reason and session.interrupted == 1

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "prompt_asked", "question_advanced", "heartbeat", "finish"]
    assert rails.calls[-1] == ("finish", "live", {"reason": "failed", "final_sequence": 1})


def test_the_end_button_after_rails_ended_the_connection_leaves_without_finishing_again():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        rails.ended = True
        assert await ctx.room.local_participant.rpc_methods["interview.choose"](rpc("end")) == "ended"
        await settle()  # leaving waits for the last room state to be published

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "heartbeat"]
    assert ctx.shutdown_reason








def test_a_wrap_up_reply_closes_after_the_current_turn_and_finishes_once_the_closing_has_played():
    rails, sessions = FakeRails(), []
    rails.heartbeat_reply = HeartbeatReply(action="wrap_up", reason="allowance",
                                           session_seconds_left=900)
    ctx, go = run_interview(rails, sessions, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.handlers["agent_state_changed"](AgentStateChangedEvent(old_state="listening", new_state="speaking"))
        await settle()
        await session.agent._runner.heartbeat()
        assert not any("live practice" in reply for reply in session.replies)
        session.handlers["agent_state_changed"](AgentStateChangedEvent(old_state="speaking", new_state="listening"))
        await settle()
        assert "live practice" in session.replies[-1]
        assert ctx.room.local_participant.attributes[-1]["cd.phase"] == "closing"
        session.handles[-1].finish()
        await settle()

    asyncio.run(scenario())
    assert rails.calls[-2:] == [("heartbeat", "live", {"sequence": 2, "billed_seconds_delta": 0, "usage": []}),
                                ("finish", "live", {"reason": "allowance", "final_sequence": 2})]
    assert ctx.shutdown_reason


def test_the_session_is_one_trace_with_ids_and_cost_but_no_content():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(ContactSpanProcessor())  # applies telemetry scopes, as in the worker
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions, tracer=provider.get_tracer("test"))

    async def scenario():
        await go()
        session = sessions[0][1]
        session.model_usage = [realtime_usage(2_000)]
        for callback in ctx.shutdown_callbacks:
            await callback()

    asyncio.run(scenario())
    (root,) = exporter.get_finished_spans()
    assert root.name == "live_interview.session" and root.parent is None
    assert dict(root.attributes) == {"interview_id": "session", "live_connection_id": "live",
                                     "prompt_version": LIVE_INTERVIEWER_PROMPT_VERSION, "user_id": "owner",
                                     "ai_task_id": "task",
                                     "provider_cost_microdollars": 20_000, "operation.cost": 0.02}


def test_a_candidate_who_drops_is_welcomed_back_or_after_two_minutes_the_interview_finishes_as_disconnected():
    rails, sessions = FakeRails(), []
    now = [0.0]
    ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        ctx.room.emit("participant_disconnected", SimpleNamespace(identity="agent-x",
                                                                  kind=rtc.ParticipantKind.PARTICIPANT_KIND_AGENT))
        ctx.room.emit("participant_disconnected", candidate())
        await settle()
        now[0] = 60.0
        await settle()
        replies = len(session.replies)
        ctx.room.emit("participant_connected", candidate())
        await settle()
        assert len(session.replies) == replies + 1 and "welcome them back" in session.replies[-1].lower()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        ctx.room.emit("participant_disconnected", candidate())
        await settle()
        now[0] = 200.0
        await settle()

    asyncio.run(scenario())
    assert rails.calls[-3:] == [
        ("answer_finished", "live", {"prompt_message_id": "opening-0", "transcript": "I rebuilt the scheduler."}),
        ("heartbeat", "live", {"sequence": 1, "billed_seconds_delta": 0, "usage": []}),
        ("finish", "live", {"reason": "disconnected", "final_sequence": 1}),
    ]
    assert ctx.shutdown_reason


def test_the_model_hears_the_candidate_only_once_the_opening_question_has_been_asked():
    """OpenAI replies to every turn of the candidate's on its own. Before the first question it has
    none to ask, so a "hello" as the room opened got a made-up question ahead of the real opening."""
    rails, sessions = FakeRails(), []
    _ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        assert session.input.audio_enabled_calls == [False]  # held back from before the session started
        session.emit_item("assistant", "Welcome. First, tell me about a project.")
        await settle()
        assert session.input.audio_enabled_calls == [False, True]
        session.emit_item("user", "I rebuilt the scheduler.")
        await session.agent.finish_answer(tool_call())
        await settle()
        assert session.input.audio_enabled_calls == [False, True]  # stays on

    asyncio.run(scenario())


def test_a_resumed_interview_past_its_question_hears_the_candidate_straight_away():
    claim = CLAIM.model_copy(update={"current_prompt_message_id": "opening-0", "current_prompt_kind": "opening"})
    rails, sessions = FakeRails(claim=claim), []
    _ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        assert sessions[0][1].input.audio_enabled_calls == [False, True]

    asyncio.run(scenario())


def test_a_fresh_agent_resumes_from_the_claim():
    claim = CLAIM.model_copy(update={"heartbeat_sequence": 4, "current_prompt_message_id": "opening-0",
                                     "current_prompt_kind": "opening", "current_prompt_answered": True,
                                     "current_question_answer_count": 1})
    rails, sessions = FakeRails(claim=claim), []
    _ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        assert "repeat question 1" in session.replies[0].lower()
        session.emit_item("user", "A fuller answer.")
        await settle()
        await session.agent.finish_answer(tool_call())
        await session.agent._runner.heartbeat()

    asyncio.run(scenario())
    assert rails.calls[1:] == [
        ("answer_finished", "live", {"prompt_message_id": "opening-0", "transcript": "A fuller answer."}),
        ("heartbeat", "live", {"sequence": 5, "billed_seconds_delta": 0, "usage": []}),
    ]


def test_a_fresh_agent_in_an_empty_room_says_nothing_and_finishes_as_disconnected_if_nobody_comes():
    rails, sessions = FakeRails(), []
    now = [0.0]
    ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)
    ctx.room.remote_participants = {}

    async def scenario():
        await go()
        assert sessions[0][1].replies == []
        now[0] = 120.0
        await settle()

    asyncio.run(scenario())
    assert rails.calls[-1] == ("finish", "live", {"reason": "disconnected", "final_sequence": 1})


async def answer_then_call_a_tool_before_the_transcript(session, call, transcript="I rebuilt the scheduler."):
    """The candidate stops speaking and the model calls a tool before the provider sends their
    final transcript (the provider may hold it back until its reply has finished generating)."""
    session.emit_item("assistant", "Tell me about a project.")
    await settle()
    session.candidate_stops_speaking()
    tool = asyncio.create_task(call)
    await settle()
    assert not tool.done()  # the decision waits for the turn that prompted it
    session.emit_item("user", transcript)
    return await tool


@pytest.mark.parametrize("tool", ["next_question", "ask_follow_up", "finish_answer"])
def test_a_tool_called_before_the_candidates_final_transcript_waits_for_it(tool):
    rails, sessions = FakeRails(), []
    _ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        call = getattr(session.agent, tool)
        arguments = ("Anything else?",) if tool == "ask_follow_up" else ()
        result = await answer_then_call_a_tool_before_the_transcript(session, call(tool_call(), *arguments))
        expected = {"next_question": "Quick feedback:", "ask_follow_up": "follow-up", "finish_answer": "saved"}[tool]
        assert expected in result  # never "not answered yet" or a skipped question

    asyncio.run(scenario())
    assert ("answer_finished", "live", {"prompt_message_id": "opening-0",
                                        "transcript": "I rebuilt the scheduler."}) in rails.calls
    assert ("question_advanced", "live", {"question_position": 0}) not in rails.calls


def test_a_transcript_that_never_comes_stops_holding_tools_back_after_a_short_wait(caplog):
    rails, sessions = FakeRails(), []
    _ctx, go = run_interview(rails, sessions, transcript_wait_seconds=0.01)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.candidate_stops_speaking()
        assert "not answered" in (await session.agent.finish_answer(tool_call())).lower()
        assert "repeat" in (await session.agent.repeat_question(tool_call())).lower()
        assert len([record for record in caplog.records if "did not arrive" in record.getMessage()]) == 1  # once
        session.emit_item("user", "A late answer.")  # it still joins the answer it belongs to
        await settle()
        assert "saved" in await session.agent.finish_answer(tool_call())

    asyncio.run(scenario())
    assert rails.calls[-1] == ("answer_finished", "live", {"prompt_message_id": "opening-0",
                                                           "transcript": "A late answer."})


def test_words_spoken_with_a_tool_call_are_a_preamble_and_the_reply_after_its_result_counts():
    rails, sessions = FakeRails(claim=CLAIM.model_copy(update={"question_total": 1})), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        agent = session.agent

        async def call_with_preamble(tool, *arguments, preamble, reply):
            speech = FakeToolSpeech()  # LiveKit speaks the tool's reply in the same speech, one step later
            result = await getattr(agent, tool)(tool_call(speech), *arguments)
            session.emit_item("assistant", preamble, speech=speech)  # added after playout, after the tool ran
            await settle()
            speech.num_steps += 1
            session.emit_item("assistant", reply, speech=speech)
            await settle()
            return result

        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        await call_with_preamble("ask_follow_up", "What changed?", preamble="Sure.", reply="What changed for the team?")
        session.emit_item("user", "Fewer failed runs.")
        await settle()
        await call_with_preamble("next_question", preamble="Okay.", reply="Quick feedback: clear story.")
        assert "finish the interview" in session.replies[-1].lower()  # the menu follows the real feedback, at the last question
        await call_with_preamble("next_question", preamble="Sure, let's wrap up.", reply="Thank you. Goodbye!")

    asyncio.run(scenario())
    assert [call for call in rails.calls if call[0] in ("prompt_asked", "feedback_given", "finish")] == [
        ("prompt_asked", "live", {"question_position": 0, "kind": "opening", "text": "Tell me about a project."}),
        ("prompt_asked", "live", {"question_position": 0, "kind": "follow_up", "text": "What changed for the team?",
                                  "prompt_key": "q0-r0-f1"}),
        ("feedback_given", "live", {"question_position": 0, "text": "Quick feedback: clear story."}),
        ("finish", "live", {"reason": "completed", "final_sequence": 1}),
    ]
    assert ctx.shutdown_reason


def test_a_lost_prompt_report_is_resent_and_its_answer_reported_once_rails_records_it():
    rails, sessions = FakeRails(), []
    rails.lose["prompt_asked"] = 1
    _ctx, go = run_interview(rails, sessions, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        assert "saved" in await session.agent.finish_answer(tool_call())
        await session.agent._runner.heartbeat()  # reports waiting behind a lost one are resent too

    asyncio.run(scenario())
    opening = ("prompt_asked", "live", {"question_position": 0, "kind": "opening", "text": "Tell me about a project."})
    assert rails.calls[1:] == [
        opening,
        opening,
        ("answer_finished", "live", {"prompt_message_id": "opening-0", "transcript": "I rebuilt the scheduler."}),
        ("heartbeat", "live", {"sequence": 1, "billed_seconds_delta": 0, "usage": []}),
    ]





def test_a_rails_call_that_never_answers_does_not_hold_up_tools_room_choices_or_the_clock():
    rails, sessions = FakeRails(), []
    rails.holds = {"prompt_asked": asyncio.Event(), "heartbeat": asyncio.Event()}  # never set
    now = [0.0]
    ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        runner = session.agent._runner
        session.emit_item("assistant", "Tell me about a project.")  # its prompt report never gets an answer
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        await asyncio.wait_for(runner.heartbeat(), 1)  # neither does this heartbeat
        result = await asyncio.wait_for(session.agent.ask_follow_up(tool_call(), "What changed?"), 1)
        assert "follow-up" in result.lower()
        session.emit_item("assistant", "What changed for the team?")
        await settle()
        choose = ctx.room.local_participant.rpc_methods["interview.choose"]
        assert await asyncio.wait_for(choose(rpc("feedback", shown_seq(ctx))), 1) == "accepted"
        session.emit_item("assistant", "Quick feedback: good start.")
        await settle()
        replies = len(session.replies)
        now[0] = 300.0  # the clock still runs: the long answer is nudged
        await settle()
        assert len(session.replies) == replies + 1

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "prompt_asked"]  # the rest waits its turn, in order


def test_leaving_waits_for_earlier_reports_and_still_delivers_the_finish_last():
    rails, sessions = FakeRails(), []
    rails.holds = {"prompt_asked": asyncio.Event()}
    ctx, go = run_interview(rails, sessions, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        end = asyncio.create_task(ctx.room.local_participant.rpc_methods["interview.choose"](rpc("end")))
        await settle()
        assert not end.done() and ctx.shutdown_reason is None  # the finish waits behind the slow report
        rails.holds["prompt_asked"].set()
        assert await asyncio.wait_for(end, 1) == "ended"
        await settle()

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "prompt_asked", "answer_finished", "heartbeat", "finish"]
    assert ctx.shutdown_reason


def test_a_finish_refused_as_connection_ended_counts_as_ended():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions, heartbeat_seconds=3600)

    async def finish_ended(connection_id, **values):
        rails.calls.append(("finish", connection_id, values))
        raise LiveConnectionEnded(409, "connection_ended")

    rails.finish = finish_ended

    async def scenario():
        await go()
        assert await ctx.room.local_participant.rpc_methods["interview.choose"](rpc("end")) == "ended"
        await settle()  # leaving waits for the last room state to be published

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "heartbeat", "finish"]
    assert ctx.shutdown_reason


def test_room_attribute_names_and_choose_options_match_the_documented_contract():
    """docs/architecture/interview-sessions.md ("Room contract") lists these literals; the web hook's
    test (apps/web/src/features/interviews/useLiveInterviewRoom.test.tsx) checks the same ones."""
    from live_interviews.agent import MENU_OPTIONS
    from live_interviews.controller import MENU_EVENTS, Phase

    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)
    asyncio.run(go())
    assert set(ctx.room.local_participant.attributes[0]) == {
        "cd.question_position", "cd.question_total", "cd.phase", "cd.state_seq", "cd.menu_offered", "cd.seconds_left",
        "cd.time_warning", "cd.answer_heard"}
    assert list(ctx.room.local_participant.rpc_methods) == ["interview.choose"]
    assert MENU_OPTIONS == {"retry", "next", "feedback"}  # plus "end", handled on its own
    assert set(MENU_EVENTS) == MENU_OPTIONS
    assert set(Phase.__args__) == {"asking", "answering", "feedback", "menu", "closing", "ended"}


def test_an_unrecoverable_model_error_mid_interview_saves_the_answer_finishes_as_failed_and_leaves():
    rails, sessions = FakeRails(), []
    now = [0.0]
    ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        session.close(CloseReason.ERROR)
        await settle()
        assert await ctx.room.local_participant.rpc_methods["interview.choose"](rpc("next", shown_seq(ctx))) == "ignored"
        now[0] = 500.0  # the clock goes on; nothing raises and nothing is said
        await settle()

    asyncio.run(scenario())
    assert rails.calls[-3:] == [
        ("answer_finished", "live", {"prompt_message_id": "opening-0", "transcript": "I rebuilt the scheduler."}),
        ("heartbeat", "live", {"sequence": 1, "billed_seconds_delta": 0, "usage": []}),
        ("finish", "live", {"reason": "failed", "final_sequence": 1}),
    ]
    assert ctx.shutdown_reason


@pytest.mark.parametrize("close_reason", [
    CloseReason.JOB_SHUTDOWN, CloseReason.PARTICIPANT_DISCONNECTED, CloseReason.USER_INITIATED])
def test_a_close_we_did_not_cause_and_is_no_model_error_leaves_without_finishing(close_reason):
    """LiveKit shuts the job down when the agent's room connection drops or the room closes. The
    interview stays open for a rejoin or a takeover (recovery ends it after a quiet spell), so the
    agent only delivers what was already on its way to Rails, then leaves."""
    rails, sessions = FakeRails(), []
    rails.holds["prompt_asked"] = asyncio.Event()
    now = [0.0]
    ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.emit_item("user", "I rebuilt the scheduler.")
        await settle()
        session.close(close_reason)
        await settle()
        now[0] = 2_000.0  # past the session clock: a running clock would wrap up and finish
        await settle()
        shutdown = asyncio.gather(*(callback() for callback in ctx.shutdown_callbacks))
        await settle()
        rails.holds["prompt_asked"].set()  # the report already queued still reaches Rails
        await shutdown

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "prompt_asked"]
    assert sessions[0][1].agent._runner._controller._prompt_message_id == "opening-0"  # Rails answered it
    assert ctx.shutdown_reason and rails.closed  # the client closes only after the delivery


def test_our_own_shutdown_closing_the_session_finishes_nothing_twice():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        await ctx.room.local_participant.rpc_methods["interview.choose"](rpc("end"))
        session.close(CloseReason.JOB_SHUTDOWN)
        await settle()

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls].count("finish") == 1


def test_the_clock_keeps_ticking_when_one_action_fails(caplog):
    rails, sessions = FakeRails(), []
    now = [0.0]
    ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Tell me about a project.")
        await settle()
        session.closed = True  # speech fails, but LiveKit has not said why yet
        now[0] = 1.0
        await settle()
        ctx.room.local_participant.fail_next = True
        now[0] = 10.0  # the room's clock refresh fails once
        await settle()
        now[0] = 200.0  # the nudge cannot be spoken
        await settle()
        session.closed = False
        ctx.room.emit("participant_disconnected", candidate())
        await settle()
        now[0] = 400.0  # the tick loop is still alive, so the away wait still ends the interview
        await settle()

    asyncio.run(scenario())
    assert rails.calls[-1] == ("finish", "live", {"reason": "disconnected", "final_sequence": 1})
    assert "RuntimeError" in caplog.text and "ConnectionError" in caplog.text and "Tell me" not in caplog.text


def test_a_room_state_publish_that_hangs_holds_up_no_tool_or_heartbeat_and_the_newest_state_wins():
    """LiveKit's set_attributes waits for its reply with no timeout, so publishing never runs under
    the controller's lock: tools and heartbeats carry on, and once LiveKit answers the room gets the
    newest state, never an older one after it."""
    from live_interviews.agent import LiveInterviewRunner
    from live_interviews.controller import FinishAnswer, InterviewerTurnFinished, Started
    rails, session, room = FakeRails(), FakeSession(), FakeRoom()
    runner = LiveInterviewRunner(session=session, rails=rails, connection_id="live", room=room, leave=lambda: None)

    async def scenario():
        room.local_participant.hold = asyncio.Event()
        await asyncio.wait_for(runner.handle(
            Started(question_position=0, question_total=2, answer_cap=2, session_seconds_left=1_500)), 1)
        await settle()  # the first state's publish has started, and hangs
        await asyncio.wait_for(runner.handle(InterviewerTurnFinished("Tell me about a project.")), 1)
        await asyncio.wait_for(runner.handle(InterviewerTurnFinished("Take your time.")), 1)
        await asyncio.wait_for(runner.heartbeat(), 1)
        assert "not answered" in (await asyncio.wait_for(runner.tool(FinishAnswer()), 1)).lower()
        await settle()
        assert [call[0] for call in rails.calls] == ["prompt_asked", "heartbeat"]
        assert room.local_participant.attributes == []  # the first publish is still waiting
        room.local_participant.hold.set()
        await settle()
        published = [(state["cd.state_seq"], state["cd.phase"]) for state in room.local_participant.attributes]
        assert published == [("1", "asking"), ("2", "answering")]  # the stale states in between were skipped

    asyncio.run(scenario())


def test_a_candidate_join_delivered_before_the_start_is_not_lost():
    """LiveKit can deliver the candidate's join while the agent is still starting, after it found
    the room empty: the interview must greet them rather than wait out the away timer."""
    from live_interviews.agent import LiveInterviewRunner
    from live_interviews.controller import CandidateJoined, CandidateLeft, Started, Tick
    rails, session, room = FakeRails(), FakeSession(), FakeRoom()
    runner = LiveInterviewRunner(session=session, rails=rails, connection_id="live", room=room, leave=lambda: None)

    async def scenario():
        await runner.handle(CandidateLeft(0.0))
        await runner.handle(CandidateJoined(1.0))
        await runner.handle(Started(question_position=0, question_total=2, answer_cap=2, session_seconds_left=1_500))
        await runner.handle(Tick(500.0))

    asyncio.run(scenario())
    assert session.replies and "question 1" in session.replies[0].lower()
    assert not [call for call in rails.calls if call[0] == "finish"]


def test_the_candidates_silence_length_setting_sets_how_long_a_pause_ends_their_turn():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)
    ctx.room.remote_participants = {"user-owner": candidate(**{"cd.silence_seconds": "4"})}  # set before we joined

    async def scenario():
        await go()
        model = sessions[0][1].llm
        assert [detection.silence_duration_ms for detection in model.turn_detections] == [4_000]
        ctx.room.emit("participant_attributes_changed", {"cd.silence_seconds": "1.5"},
                      candidate(**{"cd.silence_seconds": "1.5"}))
        ctx.room.emit("participant_attributes_changed", {"cd.silence_seconds": "60"},
                      candidate(**{"cd.silence_seconds": "60"}))  # not a choice: ignored
        ctx.room.emit("participant_attributes_changed", {"cd.silence_seconds": "1.5"},
                      SimpleNamespace(identity="agent-x", kind=rtc.ParticipantKind.PARTICIPANT_KIND_AGENT,
                                      attributes={"cd.silence_seconds": "2.5"}))  # not the candidate
        ctx.room.emit("participant_connected", candidate(**{"cd.silence_seconds": "1.5"}))  # unchanged on rejoin
        assert [detection.silence_duration_ms for detection in model.turn_detections] == [4_000, 1_500]
        assert model.turn_detections[-1].type == "server_vad"

    asyncio.run(scenario())


def test_a_reply_outside_our_instructions_and_tool_calls_is_not_saved_as_the_opening():
    """OpenAI replied to the candidate on its own before the greeting: that reply is on no speech we
    asked for, so it is not question 1, and question 1 is asked again."""
    rails, sessions = FakeRails(), []
    _ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        asked = len(session.replies)
        session.emit_item("assistant", "Go ahead, what would you like to practise today?", unprompted=True)
        await settle()
        assert not any(call[0] == "prompt_asked" for call in rails.calls)
        assert len(session.replies) == asked + 1 and "question 1" in session.replies[-1].lower()
        session.emit_item("assistant", "Sure. Tell me about a project.")  # the reply to that instruction
        await settle()

    asyncio.run(scenario())
    assert ("prompt_asked", "live", {"question_position": 0, "kind": "opening",
                                     "text": "Sure. Tell me about a project."}) in rails.calls


def test_the_interviewers_first_words_log_how_long_each_start_step_took(caplog):
    rails, sessions = FakeRails(), []
    _ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        state = sessions[0][1].handlers["agent_state_changed"]
        with caplog.at_level("INFO", logger="live_interviews.agent"):
            state(AgentStateChangedEvent(old_state="listening", new_state="speaking"))
            state(AgentStateChangedEvent(old_state="speaking", new_state="listening"))
            state(AgentStateChangedEvent(old_state="listening", new_state="speaking"))  # only the first counts
        await settle()

    asyncio.run(scenario())
    lines = [record.getMessage() for record in caplog.records if "first spoke" in record.getMessage()]
    assert len(lines) == 1
    assert all(f"{step} " in lines[0] for step in ("claim", "inputs", "join_room", "start_session"))


def test_the_model_stops_hearing_the_candidate_once_the_goodbye_starts():
    """The goodbye is the last thing said: a "thanks, bye" back gets no further (paid) reply."""
    rails, sessions = FakeRails(), []
    _ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.emit_item("assistant", "Welcome. First, tell me about a project.")
        await settle()
        from live_interviews.controller import EndRequested
        await session.agent._runner.handle(EndRequested())
        await settle()
        assert session.input.audio_enabled_calls == [False, True, False]

    asyncio.run(scenario())
