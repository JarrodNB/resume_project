"""Exercise the machine boundary with fake HTTP, without provider or bucket access."""

import asyncio
import json

import httpx
import pytest

from interviews.client import Claim, RailsClientError, RailsInterviewClient, RailsTransportError

CLAIM = {
    "operation_id": "op",
    "kind": "speech",
    "attempt_id": "attempt",
    "claim_generation": 2,
    "lease_expires_at": "2026-10-20T00:01:00Z",
    "execution_deadline": "2026-10-20T00:03:00Z",
    "payload": {"version": 1, "user_id": "owner", "interview_id": "interview", "setup": {"question_count": 9}},
}


def run(coro):
    return asyncio.run(coro)


def test_claim_uses_service_auth_and_canonical_payload():
    def respond(request):
        assert str(request.url) == "http://api:3000/internal/interviews/operations/op/claim"
        assert request.headers["Authorization"] == "Bearer service-only"
        assert "cookie" not in request.headers
        assert request.extensions["timeout"] == {"connect": 3, "read": 10, "write": 10, "pool": 10}
        return httpx.Response(200, json=CLAIM)

    async def check():
        client = RailsInterviewClient(
            "http://api:3000", "service-only", transport=httpx.MockTransport(respond)
        )
        claim = await client.claim("op")
        assert claim.payload.user_id == "owner"
        assert claim.identity() == {"attempt_id": "attempt", "claim_generation": 2}
        await client.aclose()

    run(check())


def test_ambiguous_callback_retries_identical_bytes_and_identity():
    requests = []

    def respond(request):
        requests.append(request)
        if len(requests) == 1:
            raise httpx.ReadTimeout("private URL must not escape")
        return httpx.Response(200, json={"media_id": "media"})

    async def check():
        client = RailsInterviewClient(
            "http://api:3000", "secret", transport=httpx.MockTransport(respond)
        )
        await client.register_audio(Claim.model_validate(CLAIM), "media", "checksum", 123)
        await client.aclose()

    run(check())
    assert len(requests) == 2
    assert requests[0].content == requests[1].content
    assert json.loads(requests[0].content)["claim_generation"] == 2


def test_claim_creation_is_never_retried_after_ambiguous_failure():
    requests = []

    def respond(request):
        requests.append(request)
        raise httpx.ReadTimeout("secret")

    client = RailsInterviewClient(
        "http://api:3000", "secret", transport=httpx.MockTransport(respond)
    )
    with pytest.raises(RailsTransportError, match="receipt unavailable"):
        run(client.claim("op"))
    assert len(requests) == 1


@pytest.mark.parametrize("status", [302, 401, 409, 500])
def test_error_and_redirect_bodies_are_not_exposed(status):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            status, headers={"Location": "http://evil.test/"}, text="secret transcript"
        )

    client = RailsInterviewClient(
        "http://api:3000", "secret", transport=httpx.MockTransport(respond)
    )
    with pytest.raises(RailsClientError) as error:
        run(client.status("op"))
    assert error.value.status_code == status
    assert "transcript" not in str(error.value)
    assert len(requests) == 1


@pytest.mark.parametrize("body", [b"x" * 1025, b"[]", b"invalid"])
def test_oversized_or_malformed_receipts_fail_closed(body):
    client = RailsInterviewClient(
        "http://api:3000",
        "secret",
        max_body_bytes=1024,
        transport=httpx.MockTransport(lambda _: httpx.Response(200, content=body)),
    )
    with pytest.raises(RailsTransportError):
        run(client.status("op"))


@pytest.mark.parametrize(
    "origin", ["http://api/private", "http://user:pass@api", "file:///tmp", "http://api?x=1"]
)
def test_service_origin_cannot_contain_credentials_or_paths(origin):
    with pytest.raises(ValueError):
        RailsInterviewClient(origin, "secret")


def test_wrong_claim_kind_and_identity_are_rejected():
    async def check(payload):
        client = RailsInterviewClient(
            "http://api:3000",
            "secret",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)),
        )
        with pytest.raises(RailsTransportError):
            await client.claim("op")
        await client.aclose()

    run(check({**CLAIM, "kind": "unsupported"}))
    run(check({**CLAIM, "operation_id": "another"}))


def test_claim_numbers_are_strict_not_coerced():
    client = RailsInterviewClient(
        "http://api:3000",
        "secret",
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, json={**CLAIM, "claim_generation": "2"})
        ),
    )
    with pytest.raises(RailsTransportError):
        run(client.claim("op"))


def test_busy_callback_replays_and_context_manager_closes_client():
    requests = []

    def respond(request):
        requests.append(request)
        if len(requests) == 1:
            return httpx.Response(503, json={"errors": ["busy"]})
        return httpx.Response(200, json={"lease_expires_at": CLAIM["lease_expires_at"]})

    async def check():
        async with RailsInterviewClient(
            "http://api:3000", "secret", transport=httpx.MockTransport(respond)
        ) as client:
            await client.heartbeat(Claim.model_validate(CLAIM), "speech_started")
        assert client._client.is_closed

    run(check())
    assert requests[0].content == requests[1].content
    assert json.loads(requests[0].content)["checkpoint"] == "speech_started"


def test_late_usage_preserves_observation_and_original_execution_identity():
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={})

    async def check():
        async with RailsInterviewClient(
            "http://api:3000", "secret", transport=httpx.MockTransport(respond)
        ) as client:
            await client.usage(
                Claim.model_validate(CLAIM),
                [{"cost_microdollars": 0}],
                observation_id="observation",
                incomplete=False,
            )

    run(check())
    assert json.loads(requests[0].content) == {
        "attempt_id": "attempt",
        "claim_generation": 2,
        "usage": [{"cost_microdollars": 0}],
        "observation_id": "observation",
        "incomplete": False,
    }


@pytest.mark.parametrize("receipt", [True, False])
def test_usage_accepts_boolean_ledger_receipts(receipt):
    async def check():
        async with RailsInterviewClient(
            "http://api:3000",
            "secret",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=receipt)),
        ) as client:
            assert await client.usage(Claim.model_validate(CLAIM), []) is receipt

    run(check())


@pytest.mark.parametrize("action", ["heartbeat", "recording", "status"])
@pytest.mark.parametrize("receipt", [True, False])
def test_other_endpoints_reject_boolean_receipts(action, receipt):
    async def check():
        async with RailsInterviewClient(
            "http://api:3000",
            "secret",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=receipt)),
        ) as client:
            with pytest.raises(RailsTransportError):
                if action == "status":
                    await client.status("op")
                else:
                    await getattr(client, action)(Claim.model_validate(CLAIM))

    run(check())


def test_runtime_requests_mode_and_rejects_mismatched_claim():
    requests = []

    def respond(request):
        requests.append(request)
        assert json.loads(request.content)["execution_mode"] == "real"
        return httpx.Response(200, json={**CLAIM, "execution_mode": "fake"})

    async def check():
        async with RailsInterviewClient("http://api:3000", "secret", execution_mode="real",
                                       transport=httpx.MockTransport(respond)) as client:
            with pytest.raises(RailsTransportError, match="Invalid claim"):
                await client.claim("op")
    run(check())


def test_claim_contains_frozen_validated_saved_execution_configuration():
    claim = Claim.model_validate(CLAIM)
    assert claim.execution_mode == "fake"
    assert claim.execution_config.speech_model == "fake-speech-v1"
    explicit = Claim.model_validate({**CLAIM, "execution_mode": "fake",
                                     "execution_config": claim.execution_config.model_dump()})
    assert explicit.execution_config == claim.execution_config
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        Claim.model_validate({**CLAIM, "execution_mode": "real"})
    with pytest.raises(ValidationError):
        Claim.model_validate({**CLAIM, "execution_config": {"voice": "espeak"}})


@pytest.mark.parametrize("kind", ["speech", "turn"])
def test_real_claim_validates_full_saved_configuration(kind):
    configuration = {
        "transcription_model": "gpt-transcribe", "interviewer_model": "gpt-6-luna",
        "speech_model": "gpt-4o-mini-tts", "voice": "marin",
    }
    payload = CLAIM["payload"]
    receipt = {**CLAIM, "kind": kind, "payload": payload,
               "execution_mode": "real", "execution_config": configuration}

    async def check():
        async with RailsInterviewClient(
            "http://api:3000", "secret", execution_mode="real",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=receipt)),
        ) as client:
            claim = await client.claim("op")
            assert claim.execution_mode == "real"
            assert claim.execution_config.model_dump() == configuration
    run(check())


@pytest.mark.parametrize("receipt", [{}, {"observation_id": "different"}])
def test_provider_admission_requires_matching_durable_receipt(receipt):
    async def check():
        async with RailsInterviewClient("http://api:3000", "synthetic",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=receipt))) as client:
            with pytest.raises(RailsTransportError, match="Invalid provider admission receipt"):
                await client.start_provider(Claim.model_validate(CLAIM), "observation", "speech", "fake", "scripted")
    run(check())


@pytest.mark.parametrize("action,expected_requests", [("redeem", 1), ("finish", 2), ("fail", 2)])
def test_capture_callbacks_use_fixed_owner_path_and_bounded_replay(action, expected_requests):
    requests = []

    def respond(request):
        requests.append(request)
        assert str(request.url) == "http://api:3000/internal/interviews/transcriptions/" + action
        assert request.headers["Authorization"] == "Bearer service-only"
        raise httpx.ReadTimeout("private response must not escape")

    async def check():
        async with RailsInterviewClient("http://api:3000", "service-only", transport=httpx.MockTransport(respond)) as client:
            with pytest.raises(RailsTransportError):
                await client.transcription_capture(action, {"capture_id": "owned"})

    run(check())
    assert len(requests) == expected_requests
    assert all(request.content == requests[0].content for request in requests)


@pytest.mark.parametrize("payload", [
    {"recording_id": None, "transcription_mode": "recorded"},
    {"recording_id": None, "transcription_mode": "typed", "candidate_transcript": "   "},
    {"recording_id": None, "transcription_mode": "typed", "candidate_transcript": None},
])
def test_turn_payload_distinguishes_reviewed_text_from_missing_audio(payload):
    from pydantic import ValidationError

    from tests.test_interview_executor import claim

    raw = claim().model_dump()
    raw["payload"].update(payload)
    with pytest.raises(ValidationError):
        Claim.model_validate(raw)


def test_acceptance_preserves_optional_acknowledgement_without_changing_legacy_payloads():
    requests = []

    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"revision": 1})

    async def check():
        async with RailsInterviewClient("http://api:3000", "secret", transport=httpx.MockTransport(respond)) as client:
            values = {"transcript": "I fixed the booking process.", "decision": "continue", "reply": "What changed?"}
            await client.accept(Claim.model_validate(CLAIM), **values)
            await client.accept(Claim.model_validate(CLAIM), **values, acknowledgement="You fixed the booking process.")

    run(check())
    assert "acknowledgement" not in requests[0]
    assert requests[1]["acknowledgement"] == "You fixed the booking process."
    assert {key: value for key, value in requests[1].items() if key != "acknowledgement"} == requests[0]


@pytest.mark.parametrize("omitted", [False, True])
def test_twelfth_question_can_restore_or_omit_all_eleven_earlier_questions(omitted):
    from tests.test_interview_executor import claim as turn_claim

    request = turn_claim().model_dump(mode="json")
    request["payload"]["earlier_dialogue"] = {
        "version": 1, "character_budget": 12000,
        "omitted_question_positions": list(range(11)) if omitted else [],
        "groups": [] if omitted else [{"question_position": position, "messages": [
            {"kind": "opening", "content": f"Question {position}?"}, {"kind": "answer", "content": "Accepted answer."}
        ]} for position in range(11)],
    }
    claim = Claim.model_validate(request)
    assert len(claim.payload.earlier_dialogue.omitted_question_positions if omitted else claim.payload.earlier_dialogue.groups) == 11
