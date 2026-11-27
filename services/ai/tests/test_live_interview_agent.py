"""Smoke-test the thin LiveKit adapter with fake LiveKit, Rails and database stand-ins.

No LiveKit server, OpenAI or Rails is contacted: the session, room and clients are fakes.
"""

import asyncio

import pytest
from livekit.agents import ConversationItemAddedEvent, llm

from live_interviews.agent import LiveDispatch, realtime_model_options, run_live_interview
from live_interviews.client import LiveConnectionClaim, RailsClientError
from live_interviews.instructions import LiveInterviewInputs
from live_interviews.settings import AGENT_NAME, PERSONA_VOICES, LiveInterviewSettings
from privacy.known_contact import KnownContact
from schemas.interview_setup import InterviewSetup

METADATA = '{"interview_session_id": "session", "live_connection_id": "live"}'
CLAIM = LiveConnectionClaim(interview_session_id="session", live_connection_id="live", user_id="owner",
                            question_total=5, current_question_position=0)


class FakeParticipant:
    def __init__(self):
        self.attributes = []

    async def set_attributes(self, attributes):
        self.attributes.append(attributes)


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
        self.handlers, self.replies, self.started = {}, [], None

    def on(self, event, handler):
        self.handlers[event] = handler

    async def start(self, agent, *, room, record):
        self.started = {"instructions": agent.instructions, "room": room, "record": record}

    def generate_reply(self, *, instructions):
        self.replies.append(instructions)

    def emit_item(self, role, text):
        self.handlers["conversation_item_added"](
            ConversationItemAddedEvent(item=llm.ChatMessage(role=role, content=[text])))


class FakeRails:
    def __init__(self, claim=CLAIM, refuse=False):
        self.claim_result, self.refuse, self.calls, self.closed = claim, refuse, [], False

    async def claim(self, connection_id, *, room_name):
        self.calls.append(("claim", connection_id, room_name))
        if self.refuse:
            raise RailsClientError(409)
        return self.claim_result

    async def prompt_asked(self, connection_id, **values):
        self.calls.append(("prompt_asked", connection_id, values))
        return {"message_id": "message", "question_position": 0, "revision": 2}

    async def aclose(self):
        self.closed = True


def fake_inputs(**ids):
    assert ids == {"interview_id": "session", "user_id": "owner", "connection_id": "live"}
    return LiveInterviewInputs(setup=InterviewSetup(question_count=5, interviewer="priya"),
                               questions=("First question?",), contact=KnownContact())


async def settle():
    for _ in range(5):
        await asyncio.sleep(0)


def run_interview(rails, sessions):
    ctx = FakeContext()

    def make_session(persona):
        session = FakeSession()
        sessions.append((persona, session))
        return session

    async def go():
        await run_live_interview(ctx, rails=rails, read_inputs=fake_inputs, make_session=make_session)
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
            "cd.question_position": "0", "cd.question_total": "5", "cd.phase": "asking"}
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
