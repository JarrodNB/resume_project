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
    "payload": {"text": "Saved message", "message_id": "message"},
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
        assert claim.payload.text == "Saved message"
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
        run(client.discover())
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
        run(client.discover())


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

    run(check({**CLAIM, "kind": "turn"}))
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


@pytest.mark.parametrize("action", ["heartbeat", "recording", "cleanup", "discover"])
@pytest.mark.parametrize("receipt", [True, False])
def test_other_endpoints_reject_boolean_receipts(action, receipt):
    async def check():
        async with RailsInterviewClient(
            "http://api:3000",
            "secret",
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=receipt)),
        ) as client:
            with pytest.raises(RailsTransportError):
                if action in {"cleanup", "discover"}:
                    await getattr(client, action)()
                else:
                    await getattr(client, action)(Claim.model_validate(CLAIM))

    run(check())
