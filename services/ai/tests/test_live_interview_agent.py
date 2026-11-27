"""Smoke-test the thin LiveKit adapter with fake LiveKit, Rails and database stand-ins.

No LiveKit server, OpenAI or Rails is contacted: the session, room and clients are fakes.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest
from livekit import rtc
from livekit.agents import ConversationItemAddedEvent, llm

from live_interviews.agent import LiveDispatch, realtime_model_options, run_live_interview
from live_interviews.client import LiveConnectionClaim, RailsClientError
from live_interviews.instructions import LiveInterviewInputs
from live_interviews.settings import AGENT_NAME, PERSONA_VOICES, LiveInterviewSettings
from privacy.known_contact import KnownContact
from schemas.interview_setup import InterviewSetup

METADATA = '{"interview_session_id": "session", "live_connection_id": "live"}'
CLAIM = LiveConnectionClaim(interview_session_id="session", live_connection_id="live", user_id="owner",
                            question_total=2, current_question_position=0, answer_cap=2)


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
        self.local_participant = FakeParticipant()


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


class FakeSession:
    def __init__(self):
        self.handlers, self.replies, self.started, self.agent, self.interrupted = {}, [], None, None, 0

    def on(self, event, handler):
        self.handlers[event] = handler

    async def start(self, agent, *, room, record):
        self.agent = agent
        self.started = {"instructions": agent.instructions, "room": room, "record": record}

    def interrupt(self):
        self.interrupted += 1

    def generate_reply(self, *, instructions):
        self.replies.append(instructions)

    def emit_item(self, role, text):
        self.handlers["conversation_item_added"](
            ConversationItemAddedEvent(item=llm.ChatMessage(role=role, content=[text])))


class FakeRails:
    def __init__(self, claim=CLAIM, refuse=False):
        self.claim_result, self.refuse, self.calls, self.closed = claim, refuse, [], False
        self.refuse_finish = False

    async def claim(self, connection_id, *, room_name):
        self.calls.append(("claim", connection_id, room_name))
        if self.refuse:
            raise RailsClientError(409)
        return self.claim_result

    async def prompt_asked(self, connection_id, **values):
        self.calls.append(("prompt_asked", connection_id, values))
        position = values["question_position"]
        return {"message_id": f"{values['kind']}-{position}", "question_position": position, "revision": 2}

    async def answer_finished(self, connection_id, **values):
        self.calls.append(("answer_finished", connection_id, values))
        return {"message_id": "answer", "question_position": 0, "accepted_answer_count": 1, "revision": 3}

    async def question_advanced(self, connection_id, **values):
        self.calls.append(("question_advanced", connection_id, values))
        return {"current_question_position": values["question_position"] + 1, "revision": 4}

    async def feedback_given(self, connection_id, **values):
        self.calls.append(("feedback_given", connection_id, values))
        return {"question_position": values["question_position"], "revision": 6}

    async def question_retried(self, connection_id, **values):
        self.calls.append(("question_retried", connection_id, values))
        return {"question_position": values["question_position"], "retry_count": values["retry_number"], "revision": 7}

    async def finish(self, connection_id, **values):
        self.calls.append(("finish", connection_id, values))
        if self.refuse_finish:
            raise RailsClientError(409)
        return {"status": "completed", "end_reason": values["reason"], "revision": 5}

    async def aclose(self):
        self.closed = True


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
        assert "First question?" in session.started["instructions"]
        assert "question 1" in session.replies[0].lower()
        assert ctx.room.local_participant.attributes[0] == {
            "cd.question_position": "0", "cd.question_total": "2", "cd.phase": "asking", "cd.menu_offered": "false"}
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
        assert "follow-up" in (await agent.ask_follow_up("What changed?")).lower()
        session.emit_item("assistant", "What changed for the team?")
        await settle()
        session.emit_item("user", "Fewer failed runs.")
        await settle()
        assert "Quick feedback:" in await agent.ask_follow_up("Anything else?")  # the cap is reached
        session.emit_item("assistant", "Quick feedback: clear story. Lead with the result.")
        await settle()
        assert ctx.room.local_participant.attributes[-1] == {
            "cd.question_position": "0", "cd.question_total": "2", "cd.phase": "menu", "cd.menu_offered": "true"}
        assert "hint" in session.replies[-1].lower()  # the menu is offered
        assert "finished answer" in (await agent.give_hint()).lower()
        assert "repeat" in (await agent.repeat_question()).lower()
        assert "question 1" in (await agent.retry_question()).lower()
        session.emit_item("assistant", "Let's try again: tell me about a project.")
        await settle()
        session.emit_item("user", "A sharper answer.")
        await settle()
        assert "Quick feedback:" in await agent.offer_menu()
        session.emit_item("assistant", "Quick feedback: much sharper.")
        await settle()
        assert "question 2" in (await agent.next_question()).lower()
        session.emit_item("assistant", "Next question: how do you handle conflict?")
        await settle()
        assert "thank" in (await agent.next_question()).lower()
        session.emit_item("assistant", "Thank you, goodbye!")
        await settle()

    asyncio.run(scenario())
    assert rails.calls[1:] == [
        ("prompt_asked", "live", {"question_position": 0, "kind": "opening", "text": "Tell me about a project."}),
        ("answer_finished", "live", {"prompt_message_id": "opening-0", "transcript": "I rebuilt the scheduler."}),
        ("prompt_asked", "live", {"question_position": 0, "kind": "follow_up", "text": "What changed for the team?"}),
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
        ("finish", "live", {"reason": "completed"}),
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
        await session.agent.next_question()
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
    assert rails.calls[-1] == ("finish", "live", {"reason": "ended_by_candidate"})
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
    options = realtime_model_options(LiveInterviewSettings(), "daniel")
    assert options["model"] == "gpt-realtime-2.1-mini"
    assert options["voice"] == "cedar"
    assert options["turn_detection"].type == "server_vad"
    assert options["input_audio_transcription"].model == "gpt-live-transcribe"
    assert PERSONA_VOICES == {"maya": "marin", "daniel": "cedar", "priya": "shimmer"}
    assert AGENT_NAME == "careerdrafter-live-interviewer"
