"""Keep the isolated scheduler probe bounded and honest about its coverage."""

import asyncio

import pytest

from scripts.interview_latency_probe import measure


def test_probe_exercises_real_scheduler_without_provider_or_service_clients():
    report = asyncio.run(measure(samples=2, discovery_seconds=0.02))
    assert report["mode"] == "synthetic_scheduler_only"
    assert report["samples"] == 2
    assert len(report["results"]) == 2
    assert all(row["discovery_requests"] >= 2 for row in report["results"])
    assert all(row["turn_completed_to_speech_claim_ms"] >= 0 for row in report["results"])
    assert "real_providers" in report["unmeasured"]
    assert "first_audible_speech" in report["unmeasured"]


@pytest.mark.parametrize("kwargs", [{"samples": 0}, {"samples": 21}, {"discovery_seconds": 0}, {"discovery_seconds": 11}])
def test_probe_rejects_unbounded_measurements(kwargs):
    with pytest.raises(ValueError):
        asyncio.run(measure(**kwargs))
