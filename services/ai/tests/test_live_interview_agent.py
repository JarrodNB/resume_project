"""Smoke-test the thin LiveKit adapter with fake LiveKit, Rails and database stand-ins.

No LiveKit server, OpenAI or Rails is contacted: the session, room and clients are fakes.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from livekit import rtc
from livekit.agents import (
    AgentStateChangedEvent,
    ConversationItemAddedEvent,
    UserStateChangedEvent,
    llm,
)
from livekit.agents.metrics import LLMModelUsage
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from live_interviews.agent import LiveDispatch, realtime_model_options, run_live_interview
from live_interviews.client import (
    HeartbeatReply,
    LiveConnectionClaim,
    LiveConnectionEnded,
    RailsClientError,
    RailsTransportError,
)
from live_interviews.instructions import LiveInterviewInputs
from live_interviews.settings import AGENT_NAME, PERSONA_VOICES
from privacy.known_contact import KnownContact
from schemas.interview_setup import InterviewSetup

METADATA = '{"interview_session_id": "session", "live_connection_id": "live"}'
CLAIM = LiveConnectionClaim(interview_session_id="session", live_connection_id="live", user_id="owner",
                            question_total=2, current_question_position=0, answer_cap=2, session_seconds_left=1_500,
                            allowance_seconds_left=600)


class FakeParticipant:
    def __init__(self):
        self.attributes, self.rpc_methods = [], {}

    async def set_attributes(self, attributes):
        self.attributes.append(attributes)

    def register_rpc_method(self, method_name, handler):
        self.rpc_methods[method_name] = handler


class FakeRoom:
    name = "interview-session-room"

    def __init__(self):
        self.local_participant, self.handlers = FakeParticipant(), {}
        self.remote_participants = {"user-owner": candidate()}

    def on(self, event, handler):
        self.handlers[event] = handler

    def emit(self, event, participant):
        self.handlers[event](participant)


def candidate():
    return SimpleNamespace(identity="user-owner", kind=rtc.ParticipantKind.PARTICIPANT_KIND_STANDARD)


class FakeJob:
    metadata = METADATA


class FakeContext:
    def __init__(self):
        self.job, self.room = FakeJob(), FakeRoom()
        self.connected, self.shutdown_callbacks, self.shutdown_reason = False, [], None

    async def connect(self):
        self.connected = True

    def add_shutdown_callback(self, callback):
        self.shutdown_callbacks.append(callback)

    def shutdown(self, reason=""):
        self.shutdown_reason = reason


class FakeSpeechHandle:
    def __init__(self):
        self.callbacks = []

    def add_done_callback(self, callback):
        self.callbacks.append(callback)

    def finish(self):
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


class FakeSession:
    def __init__(self):
        self.handlers, self.replies, self.started, self.agent, self.interrupted = {}, [], None, None, 0
        self.handles, self.model_usage = [], []

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
        self.interrupted += 1

    def generate_reply(self, *, instructions):
        self.replies.append(instructions)
        self.handles.append(FakeSpeechHandle())
        return self.handles[-1]

    def emit_item(self, role, text, speech=None):
        item = llm.ChatMessage(role=role, content=[text])
        if speech is not None:  # LiveKit records the item on its speech just before announcing it
            speech.chat_items.append(item)
        self.handlers["conversation_item_added"](ConversationItemAddedEvent(item=item))

    def candidate_stops_speaking(self):
        """The provider heard the end of a candidate turn; its final transcript comes later."""
        self.handlers["user_state_changed"](UserStateChangedEvent(old_state="speaking", new_state="listening"))


class FakeRails:
    def __init__(self, claim=CLAIM, refuse=False):
        self.claim_result, self.refuse, self.calls, self.closed = claim, refuse, [], False
        self.refuse_finish = self.refuse_heartbeat = self.ended = False
        self.heartbeat_error = None
        self.heartbeat_reply = HeartbeatReply(action="continue", allowance_seconds_left=500, session_seconds_left=1_400)

    async def claim(self, connection_id, *, room_name):
        self.calls.append(("claim", connection_id, room_name))
        if self.refuse:
            raise RailsClientError(409)
        return self.claim_result

    async def prompt_asked(self, connection_id, **values):
        self.calls.append(("prompt_asked", connection_id, values))
        self._refuse_if_ended()
        position = values["question_position"]
        return {"message_id": f"{values['kind']}-{position}", "question_position": position, "revision": 2}

    async def answer_finished(self, connection_id, **values):
        self.calls.append(("answer_finished", connection_id, values))
        self._refuse_if_ended()
        return {"message_id": "answer", "question_position": 0, "accepted_answer_count": 1, "revision": 3}

    async def question_advanced(self, connection_id, **values):
        self.calls.append(("question_advanced", connection_id, values))
        self._refuse_if_ended()
        return {"current_question_position": values["question_position"] + 1, "revision": 4}

    async def feedback_given(self, connection_id, **values):
        self.calls.append(("feedback_given", connection_id, values))
        self._refuse_if_ended()
        return {"question_position": values["question_position"], "revision": 6}

    async def question_retried(self, connection_id, **values):
        self.calls.append(("question_retried", connection_id, values))
        self._refuse_if_ended()
        return {"question_position": values["question_position"], "retry_count": values["retry_number"], "revision": 7}

    async def heartbeat(self, connection_id, **values):
        self.calls.append(("heartbeat", connection_id, values))
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

    def _refuse_if_ended(self):
        if self.ended:  # recovery or the owner ended the connection
            raise LiveConnectionEnded(409, "connection_ended")


def fake_inputs(**ids):
    assert ids == {"interview_id": "session", "user_id": "owner", "connection_id": "live"}
    return LiveInterviewInputs(setup=InterviewSetup(question_count=5, interviewer="priya"),
                               questions=("First question?",), contact=KnownContact())


async def settle():
    for _ in range(5):
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
        assert "First question?" in session.started["instructions"]
        assert "question 1" in session.replies[0].lower()
        assert ctx.room.local_participant.attributes[0] == {
            "cd.question_position": "0", "cd.question_total": "2", "cd.phase": "asking", "cd.menu_offered": "false",
            "cd.seconds_left": "1500", "cd.time_warning": "false"}
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


def rpc(option):
    return SimpleNamespace(request_id="r", caller_identity="user-owner", payload=json.dumps({"option": option}),
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
            "cd.question_position": "0", "cd.question_total": "2", "cd.phase": "menu", "cd.menu_offered": "true",
            "cd.seconds_left": "1500", "cd.time_warning": "false"}
        assert "hint" in session.replies[-1].lower()  # the menu is offered
        assert "finished answer" in (await agent.give_hint(tool_call())).lower()
        assert "repeat" in (await agent.repeat_question(tool_call())).lower()
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
        assert await choose(rpc("feedback")) == "accepted"
        assert session.interrupted == 1 and "answer so far" in session.replies[-1]
        session.emit_item("assistant", "Quick feedback: good start.")
        await settle()
        await session.agent.next_question(tool_call())
        session.emit_item("assistant", "Quick feedback: clear.")
        await settle()
        assert await choose(rpc("hint")) == "accepted"
        assert "finished answer" in session.replies[-1]
        assert await choose(rpc("next")) == "accepted"
        assert "question 2" in session.replies[-1].lower()

    asyncio.run(scenario())
    assert ("question_advanced", "live", {"question_position": 0}) in rails.calls


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
        now[0] = 500.0
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
        assert await choose(rpc("end")) == "ended"
        assert sessions[0][1].interrupted == 1

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


def test_a_refused_claim_ends_the_job_without_starting_a_session():
    rails, sessions = FakeRails(refuse=True), []
    ctx, go = run_interview(rails, sessions)
    asyncio.run(go())
    assert sessions == [] and ctx.shutdown_reason
    assert rails.calls == [("claim", "live", "interview-session-room")]


def test_dispatch_metadata_holds_only_the_two_ids():
    assert LiveDispatch.model_validate_json(METADATA) == LiveDispatch(interview_session_id="session",
                                                                       live_connection_id="live")
    with pytest.raises(ValueError):
        LiveDispatch.model_validate_json('{"interview_session_id": "s", "live_connection_id": "l", "text": "x"}')


def test_realtime_options_use_the_persona_voice_server_vad_and_transcription():
    options = realtime_model_options("daniel")
    assert options["model"] == "gpt-realtime-2.1-mini"
    assert options["voice"] == "cedar"
    assert options["turn_detection"].type == "server_vad"
    assert options["input_audio_transcription"].model == "gpt-live-transcribe"
    assert PERSONA_VOICES == {"maya": "marin", "daniel": "cedar", "priya": "shimmer"}
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
        assert session.interrupted == 1
        assert ctx.shutdown_reason
        replies = len(session.replies)
        assert "ended" in (await session.agent.next_question(tool_call())).lower()
        assert len(session.replies) == replies

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "heartbeat"]


def test_a_heartbeat_refused_for_an_unbilled_model_is_logged_as_an_error_with_its_code(caplog):
    rails, sessions = FakeRails(), []
    _ctx, go = run_interview(rails, sessions, heartbeat_seconds=3600)

    async def scenario():
        await go()
        rails.heartbeat_error = RailsClientError(409, "unknown_usage_model")
        with caplog.at_level("ERROR", logger="live_interviews.agent"):
            await sessions[0][1].agent._runner.heartbeat()

    asyncio.run(scenario())
    errors = [record for record in caplog.records if record.levelname == "ERROR"]
    assert len(errors) == 1 and "unknown_usage_model" in errors[0].getMessage()


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
        assert "ended" in (await session.agent.next_question(tool_call())).lower()  # the answer save is refused first
        assert ctx.shutdown_reason and session.interrupted == 1

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "prompt_asked", "answer_finished"]


def test_the_end_button_after_rails_ended_the_connection_leaves_without_finishing_again():
    rails, sessions = FakeRails(), []
    ctx, go = run_interview(rails, sessions)

    async def scenario():
        await go()
        rails.ended = True
        assert await ctx.room.local_participant.rpc_methods["interview.choose"](rpc("end")) == "ended"

    asyncio.run(scenario())
    assert [call[0] for call in rails.calls] == ["claim", "heartbeat"]
    assert ctx.shutdown_reason


def test_heartbeats_report_counted_seconds_and_new_usage_and_resend_a_lost_one_unchanged():
    rails, sessions = FakeRails(), []
    now = [0.0]
    _ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)

    async def scenario():
        ctx = await go()
        session = sessions[0][1]
        runner = session.agent._runner
        session.model_usage = [realtime_usage(1_000)]
        now[0] = 30.0
        await settle()
        await runner.heartbeat()
        rails.refuse_heartbeat = True  # Rails may have applied it; only the reply is lost
        session.model_usage = [realtime_usage(1_500)]
        now[0] = 60.0
        await settle()
        await runner.heartbeat()
        rails.refuse_heartbeat = False
        now[0] = 70.0
        await settle()
        await runner.heartbeat()
        return ctx

    asyncio.run(scenario())
    heartbeats = [call[2] for call in rails.calls if call[0] == "heartbeat"]
    entry = {"model": "gpt-realtime-2.1-mini", "cached_input_tokens": 0, "output_tokens": 0}
    lost = {"sequence": 2, "billed_seconds_delta": 30, "usage": [{**entry, "input_tokens": 500, "cost_microdollars": 5_000}]}
    assert heartbeats == [
        {"sequence": 1, "billed_seconds_delta": 30, "usage": [{**entry, "input_tokens": 1_000, "cost_microdollars": 10_000}]},
        lost,
        lost,  # resent unchanged, so Rails replays it if it was applied
        {"sequence": 3, "billed_seconds_delta": 10, "usage": []},
    ]


def test_a_heartbeat_lost_twice_holds_back_newer_seconds_until_rails_answers():
    rails, sessions = FakeRails(), []
    now = [0.0]
    _ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        runner = session.agent._runner
        rails.refuse_heartbeat = True
        now[0] = 30.0
        await settle()
        await runner.heartbeat()
        now[0] = 60.0
        await settle()
        await runner.heartbeat()  # the resend is lost too; the new 30 seconds wait
        rails.refuse_heartbeat = False
        now[0] = 65.0
        await settle()
        await runner.heartbeat()

    asyncio.run(scenario())
    heartbeats = [call[2] for call in rails.calls if call[0] == "heartbeat"]
    first = {"sequence": 1, "billed_seconds_delta": 30, "usage": []}
    assert heartbeats == [first, first, first, {"sequence": 3, "billed_seconds_delta": 35, "usage": []}]


def test_a_heartbeat_refused_outright_is_not_resent_and_its_seconds_go_with_the_next():
    rails, sessions = FakeRails(), []
    now = [0.0]
    _ctx, go = run_interview(rails, sessions, clock=lambda: now[0], tick_seconds=0, heartbeat_seconds=3600)

    async def scenario():
        await go()
        runner = sessions[0][1].agent._runner
        rails.heartbeat_error = RailsClientError(409, None)  # a definite no: nothing was applied
        now[0] = 30.0
        await settle()
        await runner.heartbeat()
        rails.heartbeat_error = None
        now[0] = 40.0
        await settle()
        await runner.heartbeat()

    asyncio.run(scenario())
    heartbeats = [call[2] for call in rails.calls if call[0] == "heartbeat"]
    assert heartbeats == [{"sequence": 1, "billed_seconds_delta": 30, "usage": []},
                          {"sequence": 2, "billed_seconds_delta": 40, "usage": []}]


def test_a_wrap_up_reply_closes_after_the_current_turn_and_finishes_once_the_closing_has_played():
    rails, sessions = FakeRails(), []
    rails.heartbeat_reply = HeartbeatReply(action="wrap_up", reason="allowance", allowance_seconds_left=0,
                                           session_seconds_left=900)
    ctx, go = run_interview(rails, sessions, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        session.handlers["agent_state_changed"](AgentStateChangedEvent(old_state="listening", new_state="speaking"))
        await settle()
        await session.agent._runner.heartbeat()
        assert not any("live minutes" in reply for reply in session.replies)
        session.handlers["agent_state_changed"](AgentStateChangedEvent(old_state="speaking", new_state="listening"))
        await settle()
        assert "live minutes" in session.replies[-1]
        assert ctx.room.local_participant.attributes[-1]["cd.phase"] == "closing"
        session.handles[-1].finish()
        await settle()

    asyncio.run(scenario())
    assert rails.calls[-2:] == [("heartbeat", "live", {"sequence": 2, "billed_seconds_delta": 0, "usage": []}),
                                ("finish", "live", {"reason": "allowance", "final_sequence": 2})]
    assert ctx.shutdown_reason


def test_a_warn_reply_is_shown_and_said_once():
    rails, sessions = FakeRails(), []
    rails.heartbeat_reply = HeartbeatReply(action="warn", allowance_seconds_left=100, session_seconds_left=900)
    ctx, go = run_interview(rails, sessions, heartbeat_seconds=3600)

    async def scenario():
        await go()
        session = sessions[0][1]
        await session.agent._runner.heartbeat()
        await session.agent._runner.heartbeat()
        assert sum("two minutes" in reply for reply in session.replies) == 1
        assert ctx.room.local_participant.attributes[-1]["cd.time_warning"] == "true"

    asyncio.run(scenario())


def test_the_session_is_one_trace_with_ids_and_cost_but_no_content():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
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
    assert dict(root.attributes) == {"interview_session_id": "session", "live_connection_id": "live",
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
        assert "hint" in session.replies[-1].lower()  # the menu follows the real feedback
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
