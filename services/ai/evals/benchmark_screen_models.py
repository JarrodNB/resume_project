"""Measure repeatable warm screening latency on the same synthetic benign inputs.

Cold local model loading is measured separately. Each timed pass has a fresh
screening session, so task-local decision reuse cannot make a pass look faster.
"""

import argparse
import json
from math import ceil
from pathlib import Path
from statistics import mean, median
from time import monotonic

import logfire

from screening import local_llama
from screening.screen_user_text import observe_screen_chunks, screen_user_text
from screening.session import screening_session
from worker.settings import load_settings

SIZES = (160, 1600, 5000, 12000)
MODELS = {"jev": "typesafe:jev-1.13.0", "llama": local_llama.MODEL}
BENIGN_TEXT = "Built reliable billing services and documented the release process. "


def _text_of_length(length: int) -> str:
    return (BENIGN_TEXT * (length // len(BENIGN_TEXT) + 1))[:length]


def _measure(text: str, model: str) -> dict:
    chunks = 0

    def attempted():
        nonlocal chunks
        chunks += 1

    settings = load_settings()
    started = monotonic()
    with (logfire.suppress_instrumentation(), screening_session(settings.llm_run_timeout_seconds),
          observe_screen_chunks(attempted)):
        outcome = screen_user_text(text, model, settings.llm_run_timeout_seconds,
                                   check_phrases=False)
    elapsed = monotonic() - started
    if not outcome.allowed:
        state = "unavailable" if outcome.unchecked or outcome.too_long else "blocked"
        raise RuntimeError(f"Benchmark input was {state} by {model}")
    return {"seconds": elapsed, "chunks": chunks}


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, ceil(len(ordered) * fraction) - 1)]


def run_benchmark(repeats: int = 10, output_path: Path | None = None) -> dict:
    """Return cold-load and warm p50/p90 timings by input size and model."""
    if repeats < 2:
        raise ValueError("At least two repeats are needed for a latency comparison")
    started = monotonic()
    local_llama._model_pair()
    load_seconds = monotonic() - started
    for model in MODELS.values():
        _measure(_text_of_length(SIZES[0]), model)

    samples = {length: {name: [] for name in MODELS} for length in SIZES}
    for repeat in range(repeats):
        for length in SIZES:
            text = _text_of_length(length)
            order = tuple(MODELS) if repeat % 2 == 0 else tuple(reversed(MODELS))
            for name in order:
                samples[length][name].append(_measure(text, MODELS[name]))

    by_size = {}
    for length, models in samples.items():
        by_size[str(length)] = {}
        for name, runs in models.items():
            seconds = [run["seconds"] for run in runs]
            by_size[str(length)][name] = {
                "seconds": seconds,
                "chunks": [run["chunks"] for run in runs],
                "mean_seconds": mean(seconds),
                "p50_seconds": median(seconds),
                "p90_seconds": _percentile(seconds, 0.9),
            }
    report = {
        "cold_llama_load_seconds": load_seconds,
        "warmup": "One untimed input per model after local model load",
        "repeats": repeats,
        "sizes": by_size,
        "limitations": [
            "Sequential runs alternate model order; Jev includes network latency.",
            "Benign inputs run through all chunks; blocked inputs stop early and need separate timing.",
            "Cold load uses the available Hugging Face cache and varies by machine and cache state.",
        ],
    }
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeats", type=int, default=10)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    run_benchmark(args.repeats, args.output)


if __name__ == "__main__":
    main()
