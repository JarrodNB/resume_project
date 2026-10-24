"""Verify the latency benchmark compares aligned inputs and records repeat samples."""

import threading
from types import SimpleNamespace
from unittest.mock import patch

from evals import benchmark_screen_models as benchmark


def test_benchmark_uses_same_text_and_alternates_model_order(monkeypatch):
    seen = []
    monkeypatch.setattr(benchmark.local_llama, "_model_pair", lambda: None)

    def measure(text, model):
        seen.append((text, model))
        return {"seconds": 0.1 if model == benchmark.MODELS["jev"] else 0.2,
                "chunks": 1 if len(text) < 5000 else 3, "error": None}

    monkeypatch.setattr(benchmark, "_measure", measure)
    report = benchmark.run_benchmark(repeats=2)
    assert report["settings"]["jev_chunk_characters"] in (2000, 4000)
    assert report["settings"]["llama_max_tokens"] == 512
    assert len(seen) == 2 + 2 * len(benchmark.SIZES) * 2 + 2 * 2 * 2
    for size in benchmark.SIZES:
        results = report["sizes"][str(size)]
        assert [sample["seconds"] for sample in results["jev"]["samples"]] == [0.1, 0.1]
        assert [sample["seconds"] for sample in results["llama"]["samples"]] == [0.2, 0.2]
        assert all(len(text) == size for text, _ in seen if len(text) == size)
    first_round = seen[2:2 + len(benchmark.SIZES) * 2]
    second_round = seen[2 + len(benchmark.SIZES) * 2:]
    assert [model for _, model in first_round[:2]] == list(benchmark.MODELS.values())
    assert [model for _, model in second_round[:2]] == list(reversed(benchmark.MODELS.values()))
    assert report["local_concurrency_control"]["5000"]["serial"]["successful_samples"] == 2


def test_fallback_sample_is_excluded_from_jev_latency(monkeypatch):
    monkeypatch.setattr(benchmark, "screen_user_text", lambda *_args, **_kwargs: SimpleNamespace(
        allowed=True, model_usages=[SimpleNamespace(model="openai:gpt-5-nano")],
    ))
    sample = benchmark._measure("synthetic career note", benchmark.MODELS["jev"])
    assert sample["error"] == "fallback_or_unknown_model"
    assert sample["seconds"] >= 0


def test_late_failure_keeps_completed_samples(tmp_path, monkeypatch):
    monkeypatch.setattr(benchmark.local_llama, "_model_pair", lambda: None)
    calls = 0

    def measure(text, model):
        nonlocal calls
        calls += 1
        return {"seconds": 0.1, "chunks": 1, "error": "unavailable" if calls == 6 else None}

    monkeypatch.setattr(benchmark, "_measure", measure)
    output = tmp_path / "benchmark.json"
    report = benchmark.run_benchmark(repeats=2, output_path=output)
    assert output.exists()
    assert any(sample["error"] == "unavailable" for size in report["sizes"].values()
               for model in size.values() for sample in model["samples"])
    assert report["sizes"]["1600"]["llama"]["successful_samples"] == 1


def test_serial_control_really_limits_local_chunk_inference(monkeypatch):
    state = {"active": 0, "peak": 0}
    lock = threading.Lock()
    monkeypatch.setattr(benchmark.local_llama, "iter_chunks", lambda text: iter([
        (text[index:index + 1], 1) for index in range(4)
    ]))

    def classify(chunk, model, timeout):
        with lock:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        threading.Event().wait(0.02)
        with lock:
            state["active"] -= 1
        return SimpleNamespace(blocked=False, tokens=1, duration=0.02)

    monkeypatch.setattr(benchmark.local_llama, "classify_chunk", classify)
    with patch.object(benchmark.screening_module, "MAX_LOCAL_CHUNKS_IN_FLIGHT", 1):
        serial = benchmark._measure("ordinary synthetic note", benchmark.MODELS["llama"])
    serial_peak = state["peak"]
    state["peak"] = 0
    parallel = benchmark._measure("ordinary synthetic note", benchmark.MODELS["llama"])
    assert serial["error"] is None and parallel["error"] is None
    assert serial_peak == 1
    assert 2 <= state["peak"] <= benchmark.MAX_LOCAL_CHUNKS_IN_FLIGHT
