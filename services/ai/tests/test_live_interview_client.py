"""Exercise the live agent's Rails callbacks against fake HTTP (no Rails, no LiveKit)."""

import asyncio
import json

import httpx
import pytest

from live_interviews.client import (
    LiveConnectionClaim,
    RailsClientError,
    RailsLiveInterviewClient,
    RailsTransportError,
)

CLAIM = {"interview_session_id": "session", "live_connection_id": "live", "user_id": "owner",
         "question_total": 5, "current_question_position": 0, "answer_cap": 2}


def run(coro):
    return asyncio.run(coro)


def client_for(respond):
    return RailsLiveInterviewClient("http://api:3000", "service-only", transport=httpx.MockTransport(respond))


def test_claim_posts_the_room_with_service_auth_and_validates_the_receipt():
    seen = []

    def respond(request):
        seen.append(request)
        return httpx.Response(200, json=CLAIM)

    async def check():
        async with client_for(respond) as client:
            return await client.claim("live", room_name="interview-session-room")

    claim = run(check())
    assert claim == LiveConnectionClaim(**CLAIM)
    request = seen[0]
    assert str(request.url) == "http://api:3000/internal/interviews/live_connections/live/claim"
    assert request.headers["Authorization"] == "Bearer service-only"
    assert json.loads(request.content) == {"room_name": "interview-session-room"}


def test_claim_rejects_a_receipt_for_another_connection():
    async def check():
        async with client_for(lambda _request: httpx.Response(200, json={**CLAIM, "live_connection_id": "other"})) as client:
            await client.claim("live", room_name="room")

    with pytest.raises(RailsTransportError):
        run(check())


def test_refusals_surface_as_client_errors():
    async def check():
        async with client_for(lambda _request: httpx.Response(409, json={"errors": ["Live connection has ended"]})) as client:
            await client.claim("live", room_name="room")

    with pytest.raises(RailsClientError) as error:
        run(check())
    assert error.value.status_code == 409


def test_prompt_asked_retries_the_identical_request_once_after_a_lost_reply():
    seen = []

    def respond(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadTimeout("lost")
        return httpx.Response(200, json={"message_id": "message", "question_position": 0, "revision": 2})

    async def check():
        async with client_for(respond) as client:
            return await client.prompt_asked("live", question_position=0, kind="opening", text="First question?")

    receipt = run(check())
    assert receipt == {"message_id": "message", "question_position": 0, "revision": 2}
    assert [str(r.url) for r in seen] == ["http://api:3000/internal/interviews/live_connections/live/prompt_asked"] * 2
    assert seen[0].content == seen[1].content
    assert json.loads(seen[0].content) == {"question_position": 0, "kind": "opening", "text": "First question?"}


def recorded_calls(responses):
    seen = []

    def respond(request):
        seen.append(request)
        return httpx.Response(200, json=responses[len(seen) - 1])

    return seen, respond


def test_claim_carries_the_answer_cap():
    async def check():
        async with client_for(lambda _request: httpx.Response(200, json=CLAIM)) as client:
            return await client.claim("live", room_name="room")

    assert run(check()).answer_cap == 2


def test_a_follow_up_carries_a_fresh_prompt_key_that_a_retry_reuses():
    seen = []

    def respond(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadTimeout("lost")
        return httpx.Response(200, json={"message_id": "follow", "question_position": 0, "revision": 4})

    async def check():
        async with client_for(respond) as client:
            await client.prompt_asked("live", question_position=0, kind="follow_up", text="What changed?")
            await client.prompt_asked("live", question_position=0, kind="follow_up", text="What changed?")

    run(check())
    bodies = [json.loads(request.content) for request in seen]
    assert bodies[0] == bodies[1]
    assert bodies[0]["kind"] == "follow_up" and bodies[0]["text"] == "What changed?"
    assert len(bodies[0]["prompt_key"]) >= 32
    assert bodies[2]["prompt_key"] != bodies[0]["prompt_key"]


def test_answer_advance_and_finish_post_only_ids_positions_and_text():
    seen, respond = recorded_calls([
        {"message_id": "answer", "question_position": 0, "accepted_answer_count": 1, "revision": 3},
        {"current_question_position": 1, "revision": 4},
        {"status": "completed", "end_reason": "completed", "revision": 5},
    ])

    async def check():
        async with client_for(respond) as client:
            await client.answer_finished("live", prompt_message_id="opening", transcript="I rebuilt it.")
            await client.question_advanced("live", question_position=0)
            return await client.finish("live", reason="completed")

    assert run(check()) == {"status": "completed", "end_reason": "completed", "revision": 5}
    base = "http://api:3000/internal/interviews/live_connections/live/"
    assert [(str(r.url), json.loads(r.content)) for r in seen] == [
        (base + "answer_finished", {"prompt_message_id": "opening", "transcript": "I rebuilt it."}),
        (base + "question_advanced", {"question_position": 0}),
        (base + "finish", {"reason": "completed"}),
    ]
