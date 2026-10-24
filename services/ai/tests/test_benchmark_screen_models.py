"""Verify the latency benchmark compares aligned inputs and records repeat samples."""

from evals import benchmark_screen_models as benchmark


def test_benchmark_uses_same_text_and_alternates_model_order(monkeypatch):
    seen = []
    monkeypatch.setattr(benchmark.local_llama, "_model_pair", lambda: None)

    def measure(text, model):
        seen.append((text, model))
        return {"seconds": 0.1 if model == benchmark.MODELS["jev"] else 0.2,
                "chunks": 1 if len(text) < 5000 else 3}

    monkeypatch.setattr(benchmark, "_measure", measure)
    report = benchmark.run_benchmark(repeats=2)
    assert len(seen) == 2 + 2 * len(benchmark.SIZES) * 2
    for size in benchmark.SIZES:
        results = report["sizes"][str(size)]
        assert results["jev"]["seconds"] == [0.1, 0.1]
        assert results["llama"]["seconds"] == [0.2, 0.2]
        assert all(len(text) == size for text, _ in seen if len(text) == size)
    first_round = seen[2:2 + len(benchmark.SIZES) * 2]
    second_round = seen[2 + len(benchmark.SIZES) * 2:]
    assert [model for _, model in first_round[:2]] == list(benchmark.MODELS.values())
    assert [model for _, model in second_round[:2]] == list(reversed(benchmark.MODELS.values()))
