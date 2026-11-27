"""Exercise the live agent's Rails callbacks against fake HTTP (no Rails, no LiveKit)."""

import asyncio
import json

import httpx
import pytest

from live_interviews.client import (
    HeartbeatReply,
    LiveConnectionClaim,
    RailsClientError,
    RailsLiveInterviewClient,
    RailsTransportError,
)

CLAIM = {"interview_session_id": "session", "live_connection_id": "live", "user_id": "owner",
         "question_total": 5, "current_question_position": 0, "answer_cap": 2, "session_seconds_left": 1_500,
         "allowance_seconds_left": 600}


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


def test_a_follow_up_carries_its_prompt_key_and_a_retry_sends_the_identical_request():
    seen = []

    def respond(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadTimeout("lost")
        return httpx.Response(200, json={"message_id": "follow", "question_position": 0, "revision": 4})

    async def check():
        async with client_for(respond) as client:
            await client.prompt_asked("live", question_position=0, kind="follow_up", text="What changed?",
                                      prompt_key="q0-r0-f1")

    run(check())
    bodies = [json.loads(request.content) for request in seen]
    assert bodies[0] == bodies[1] == {"question_position": 0, "kind": "follow_up", "text": "What changed?",
                                      "prompt_key": "q0-r0-f1"}


def test_claim_carries_where_the_current_question_stands_for_a_fresh_agent():
    restore = {"heartbeat_sequence": 7, "current_prompt_message_id": "follow", "current_prompt_kind": "follow_up",
               "current_prompt_answered": True, "current_question_answer_count": 2, "current_question_feedback_given": True}

    async def check():
        async with client_for(lambda _request: httpx.Response(200, json={**CLAIM, **restore})) as client:
            return await client.claim("live", room_name="room")

    claim = run(check())
    assert (claim.heartbeat_sequence, claim.current_prompt_message_id, claim.current_prompt_kind) == (7, "follow", "follow_up")
    assert (claim.current_prompt_answered, claim.current_question_answer_count, claim.current_question_feedback_given) == (
        True, 2, True)


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


def test_claim_carries_the_current_question_retry_count_defaulting_to_none_used():
    async def check(body):
        async with client_for(lambda _request: httpx.Response(200, json=body)) as client:
            return await client.claim("live", room_name="room")

    assert run(check({**CLAIM, "current_question_retry_count": 2})).current_question_retry_count == 2
    assert run(check(CLAIM)).current_question_retry_count == 0
    with pytest.raises(RailsTransportError):
        run(check({**CLAIM, "current_question_retry_count": 3}))


def test_feedback_and_retry_post_only_positions_numbers_and_the_spoken_feedback():
    seen, respond = recorded_calls([
        {"question_position": 0, "revision": 6},
        {"question_position": 0, "retry_count": 1, "revision": 7},
    ])

    async def check():
        async with client_for(respond) as client:
            await client.feedback_given("live", question_position=0, text="Quick feedback: clear. Lead with the result.")
            return await client.question_retried("live", question_position=0, retry_number=1)

    assert run(check()) == {"question_position": 0, "retry_count": 1, "revision": 7}
    base = "http://api:3000/internal/interviews/live_connections/live/"
    assert [(str(r.url), json.loads(r.content)) for r in seen] == [
        (base + "feedback_given", {"question_position": 0, "text": "Quick feedback: clear. Lead with the result."}),
        (base + "question_retried", {"question_position": 0, "retry_number": 1}),
    ]


def test_claim_carries_the_session_clock_and_allowance_seconds():
    async def check(body):
        async with client_for(lambda _request: httpx.Response(200, json=body)) as client:
            return await client.claim("live", room_name="room")

    claim = run(check(CLAIM))
    assert (claim.session_seconds_left, claim.allowance_seconds_left) == (1_500, 600)
    with pytest.raises(RailsTransportError):
        run(check({key: value for key, value in CLAIM.items() if key != "session_seconds_left"}))


def test_heartbeat_posts_its_sequence_billed_seconds_and_usage_and_validates_the_reply():
    seen, respond = recorded_calls([
        {"action": "wrap_up", "reason": "allowance", "allowance_seconds_left": 0, "session_seconds_left": 700},
        {"action": "dance", "allowance_seconds_left": 0, "session_seconds_left": 700},
    ])
    usage = [{"model": "gpt-realtime-2.1-mini", "input_tokens": 10, "cached_input_tokens": 0, "output_tokens": 5,
              "cost_microdollars": 120}]

    async def check():
        async with client_for(respond) as client:
            reply = await client.heartbeat("live", sequence=3, billed_seconds_delta=30, usage=usage)
            with pytest.raises(RailsTransportError):
                await client.heartbeat("live", sequence=4, billed_seconds_delta=0, usage=[])
            return reply

    assert run(check()) == HeartbeatReply(action="wrap_up", reason="allowance", allowance_seconds_left=0,
                                          session_seconds_left=700)
    assert str(seen[0].url) == "http://api:3000/internal/interviews/live_connections/live/heartbeat"
    assert json.loads(seen[0].content) == {"sequence": 3, "billed_seconds_delta": 30, "usage": usage}


def test_finish_names_the_final_heartbeat_when_there_is_one():
    seen, respond = recorded_calls([{"status": "completed", "end_reason": "time_limit", "revision": 5}])

    async def check():
        async with client_for(respond) as client:
            return await client.finish("live", reason="time_limit", final_sequence=7)

    run(check())
    assert json.loads(seen[0].content) == {"reason": "time_limit", "final_sequence": 7}
