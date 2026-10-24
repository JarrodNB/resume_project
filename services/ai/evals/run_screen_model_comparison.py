"""Compare production Jev and local Llama screening on aligned synthetic inputs.

The runner records only case identifiers and aggregate decisions. It does not print,
serialize, or attach screened text to evaluation spans. Production screening still
stops at its first blocked or unavailable chunk, so counts are attempted chunks.
"""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from threading import Lock
from time import monotonic

import logfire
import yaml

import screening.screen_user_text as screening
from evals.run_screen_chunk_comparison import build_resume_cases
from evals.telemetry import eval_run, record_score
from screening import local_llama
from screening.session import screening_session
from worker.settings import load_settings

DATASET_PATH = Path(__file__).parent / "datasets" / "user_text_screen_cases.yaml"
MODELS = ("jev", "llama")


@dataclass(frozen=True)
class ComparisonCase:
    """Hand labels stay outside the string sent to either production classifier."""

    name: str
    text: str
    prompt_injection: bool
    harmful_request: bool


def load_cases() -> list[ComparisonCase]:
    """Reuse the existing synthetic Jev cases, including harmful-only examples."""
    source = yaml.safe_load(DATASET_PATH.read_text(encoding="utf-8"))
    short_cases = [ComparisonCase(row["name"], row["inputs"]["text"],
                                  row["metadata"]["prompt_injection"],
                                  row["metadata"]["harmful_request"])
                   for row in source["cases"]]
    long_cases = [ComparisonCase(row.name, row.text, row.expected_block, False)
                  for row in build_resume_cases()]
    return short_cases + long_cases


def evaluate_case(case: ComparisonCase) -> dict:
    """Run both classifiers independently through the shared production policy."""
    settings = load_settings()
    results = {}
    for name, model in (("jev", "typesafe:jev-1.13.0"), ("llama", local_llama.MODEL)):
        counter = {"count": 0, "closed": False}
        count_lock = Lock()

        def observed(counter=counter, count_lock=count_lock):
            with count_lock:
                if not counter["closed"]:
                    counter["count"] += 1

        started = monotonic()
        error = None
        try:
            with (logfire.suppress_instrumentation(), screening_session(settings.llm_run_timeout_seconds),
                  screening.observe_screen_chunks(observed)):
                outcome = screening.screen_user_text(case.text, model,
                                                     settings.llm_run_timeout_seconds,
                                                     check_phrases=False)
            decision = ("unavailable" if outcome.unchecked or outcome.too_long else
                        "allow" if outcome.allowed else "block")
            if outcome.too_long:
                error = "too_long"
            elif outcome.unchecked:
                error = "screening_unavailable"
        except Exception as exc:  # noqa: BLE001 — report unavailable without user text
            decision = "unavailable"
            error = type(exc).__name__
        finally:
            with count_lock:
                counter["closed"] = True
                count = counter["count"]
        expected_block = case.prompt_injection or (name == "jev" and case.harmful_request)
        results[name] = {
            "decision": decision, "chunk_count": count,
            "elapsed_seconds": monotonic() - started, "error": error,
            "wrong_decision": decision != "unavailable" and
            (decision == "block") != expected_block,
        }
    return results


def run_comparison(output_path: Path | None = None) -> dict:
    """Emit privacy-safe paired evidence; outages remain distinct from wrong decisions."""
    rows = []
    with eval_run("evals.screen_model_comparison", metadata={"models": list(MODELS)}):
        for case in load_cases():
            result = evaluate_case(case)
            row = {"case": case.name, "prompt_injection": case.prompt_injection,
                   "harmful_request": case.harmful_request, **result}
            rows.append(row)
            with logfire.span("screen_model_comparison_case", case=case.name,
                              jev_decision=result["jev"]["decision"],
                              llama_decision=result["llama"]["decision"],
                              jev_chunks=result["jev"]["chunk_count"],
                              llama_chunks=result["llama"]["chunk_count"],
                              jev_error=result["jev"]["error"],
                              llama_error=result["llama"]["error"],
                              jev_elapsed_seconds=result["jev"]["elapsed_seconds"],
                              llama_elapsed_seconds=result["llama"]["elapsed_seconds"]):
                pass
        summary = {model: {
            "unavailable": sum(row[model]["decision"] == "unavailable" for row in rows),
            "wrong_decisions": sum(row[model]["wrong_decision"] for row in rows),
            "chunks": sum(row[model]["chunk_count"] for row in rows),
            "elapsed_seconds": sum(row[model]["elapsed_seconds"] for row in rows),
        } for model in MODELS}
        for model in MODELS:
            record_score(f"{model}.unavailable", summary[model]["unavailable"])
            record_score(f"{model}.wrong_decisions", summary[model]["wrong_decisions"])
    report = {"models": {"jev": "typesafe:jev-1.13.0", "llama": local_llama.MODEL},
              "summary": summary, "results": rows,
              "limitations": ["Sequential single-run timing; provider and cache conditions vary.",
                              "Chunk counts stop at the first block or unavailable result.",
                              "Harmful-only cases are outside Llama prompt-injection scope."]}
    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = run_comparison(args.output)
    if any(summary["unavailable"] or summary["wrong_decisions"]
           for summary in report["summary"].values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
