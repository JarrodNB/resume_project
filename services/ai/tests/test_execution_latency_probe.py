"""Exercise the common HTTP start probe without queues, providers or feature runtimes."""

from scripts.execution_latency_probe import measure


def test_probe_measures_the_common_push_runner_without_queue_consumers():
    report = measure(samples=2, concurrency=1)
    assert report["successes"] == 2
    assert report["queue_consumers"] == 0
    assert report["provider_requests"] == 0
    assert report["errors"] == report["overloads"] == 0
    assert report["receipt"]["p95_ms"] >= 0
    assert report["execution_start"]["p95_ms"] >= 0
    assert "excludes Rails commits" in report["limits"]
