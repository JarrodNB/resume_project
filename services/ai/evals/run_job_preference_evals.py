"""Run bounded synthetic native-JEV probability evaluations through the production worker.

`--batch-smoke` checks three postings with three preferences plus one ten-preference
boundary posting: exactly four assessment calls, no tuning, retries or screening calls.
Prints numeric outcomes, accounting and latency; creates no report files.
"""
import argparse
import json
from pathlib import Path
from time import monotonic
from types import SimpleNamespace
from uuid import uuid4

from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import Evaluator

from agents.job_preference_agent import JEV_PREFERENCE_MODEL
from evals.job_preference_evaluators import (
    PreferenceEvalInput,
    PreferenceEvalLabels,
    PreferenceEvalOutput,
    PreferenceOutcome,
)
from evals.telemetry import evaluate_dataset
from llm.usage import collect_task_usage
from prompts.job_preference_instructions import JOB_PREFERENCE_PROMPT_VERSION
from settings import load_settings
from worker.job_preference_handler import handle_job_preference_check_task


def load_job_preference_dataset():
    return Dataset[PreferenceEvalInput, PreferenceEvalOutput, PreferenceEvalLabels].from_file(
        Path(__file__).parent / "datasets/job_preference_cases.yaml", custom_evaluator_types=(PreferenceOutcome,))


def _task(criteria, postings):
    return SimpleNamespace(ai_task_id=uuid4(), input={"profile_id": str(uuid4()), "confirmed_revision": 1,
        "criteria": [{"id": str(uuid4()), "text": text, "priority": priority} for text, priority in criteria],
        "listings": [{"id": str(uuid4()), "source_digest": "a" * 64, "truncated": False,
            "passages": [{"id": f"P{i + 1}", "text": text} for i, text in enumerate(posting)]} for posting in postings]})


def _execute(task, costs):
    started = monotonic()
    with collect_task_usage() as usage:
        try:
            result = handle_job_preference_check_task(task, SimpleNamespace(settings=load_settings()))
        finally:
            costs.append({"elapsed_seconds": round(monotonic() - started, 3), "requests_with_usage": len(usage.entries),
                "input_tokens": sum(e.input_tokens for e in usage.entries), "output_tokens": sum(e.output_tokens for e in usage.entries),
                "cost_microdollars": sum(e.cost_microdollars or 0 for e in usage.entries), "usage_incomplete": usage.incomplete})
    return result


def _check_report(report, scores):
    if not report.cases or report.failures or any(case.evaluator_failures or any(case.scores.get(key) is None
        or case.scores[key].value != 1 for key in scores) for case in report.cases):
        raise RuntimeError("Preference probability evaluation failed; inspect numeric cases and provider errors")


def run_job_preference_evals():
    """Eight serial synthetic cases; broad expected bands remain outside model inputs."""
    costs = []
    def assess(case):
        result = _execute(_task([(case.criterion, "must_have")], [case.passages]), costs)
        probability = result.result["listings"][0]["criteria"][0]["probability"] if result.status == "completed" else None
        return PreferenceEvalOutput(status=result.status, probability=probability)
    report = evaluate_dataset(load_job_preference_dataset, assess, name="evals.job_preferences",
        metadata={"model": JEV_PREFERENCE_MODEL, "prompt_version": JOB_PREFERENCE_PROMPT_VERSION, "run_count": 1},
        version=JOB_PREFERENCE_PROMPT_VERSION, max_concurrency=1)
    for case in report.cases:
        print(case.name, case.output.model_dump())
    print("Preference evaluation provider accounting:", json.dumps(costs))
    _check_report(report, ("probability_valid", "expected_band"))
    return report


class BatchSmokeOutcome(Evaluator):
    """Verify broad directional fit, independent scores and the 10-preference boundary."""
    def evaluate(self, ctx):
        values = ctx.output["probabilities"]
        valid = len(values) == len(ctx.metadata["bands"]) and all(len(row) == len(bands) and
            all(isinstance(p, (int, float)) and not isinstance(p, bool) and 0 <= p <= 1 for p in row)
            for row, bands in zip(values, ctx.metadata["bands"], strict=True))
        band = valid and all(low <= p <= high for row, bands in zip(values, ctx.metadata["bands"], strict=True)
            for p, (low, high) in zip(row, bands, strict=True))
        independent = valid and sum(values[0]) > 1
        return {"probability_valid": float(valid), "expected_band": float(band),
            "independent": float(independent), "order_match": float(ctx.output["order"] == ctx.metadata["order"])}


def load_job_preference_batch_smoke_dataset():
    """Three contrasting postings and one maximum-size schema; labels stay evaluator-only."""
    return Dataset(name="job-preference-probability-smoke", cases=[
        Case(name="three-listing-batch", inputs={
            "criteria": [("Fully remote work with no required office days", "must_have"),
                ("Annual salary of at least USD 150000", "must_have"), ("Work for a climate technology company", "nice_to_have")],
            "listings": [
                ["This job is fully remote with no office visits. The annual salary is USD 160000. Our company builds climate technology."],
                ["This position requires five days a week in our Boston office. Annual salary is USD 140000. Our company does not work on climate technology."],
                ["We are hiring an engineer to build useful software. Contact recruiting for details."],
            ]}, metadata={"bands": [[(0.75, 1.0)] * 3, [(0.0, 0.25)] * 3, [(0.1, 0.9)] * 3], "order": [0, 2, 1]}),
        Case(name="ten-preference-boundary", inputs={
            "criteria": [(text, "must_have") for text in ["Fully remote", "No office attendance", "Annual salary at least USD 150000",
                "Climate technology company", "Permanent employment", "Full-time work", "US-based role", "Python engineering", "Paid vacation", "Health insurance"]],
            "listings": [["This permanent full-time US-based Python engineering role is fully remote with no office attendance. Annual salary is USD 160000. We build climate technology and offer paid vacation and health insurance."]]},
            metadata={"bands": [[(0.75, 1.0)] * 10], "order": [0]}),
    ], evaluators=[BatchSmokeOutcome()])


def run_job_preference_batch_smoke():
    """Exactly four tiny synthetic assessment calls, using independent native probabilities."""
    costs = []
    def assess(case):
        result = _execute(_task(case["criteria"], case["listings"]), costs)
        if result.status != "completed":
            raise RuntimeError("The probability smoke did not complete")
        values = [[c["probability"] for c in item["criteria"]] for item in result.result["listings"]]
        def score(index):
            def mean(priority):
                group = [p for p, (_, kind) in zip(values[index], case["criteria"], strict=True) if kind == priority]
                return sum(group) / len(group) if group else 0
            return (-mean("must_have"), -mean("nice_to_have"), index)
        return {"probabilities": values, "order": sorted(range(len(values)), key=score)}
    report = evaluate_dataset(load_job_preference_batch_smoke_dataset, assess, name="evals.job_preferences.probability_smoke",
        metadata={"model": JEV_PREFERENCE_MODEL, "prompt_version": JOB_PREFERENCE_PROMPT_VERSION, "run_count": 1},
        version=JOB_PREFERENCE_PROMPT_VERSION, max_concurrency=1)
    print("Probability smoke provider accounting:", json.dumps(costs))
    for case in report.cases:
        print(case.name, case.output)
    if sum(item["requests_with_usage"] for item in costs) > 4 or sum(item["input_tokens"] + item["output_tokens"] for item in costs) > 16_000:
        raise RuntimeError("Probability smoke exceeded its reported request/token bound")
    _check_report(report, ("probability_valid", "expected_band", "independent", "order_match"))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-smoke", action="store_true", help="Run one bounded probability/boundary smoke instead of the full suite")
    args = parser.parse_args()
    run_job_preference_batch_smoke() if args.batch_smoke else run_job_preference_evals()
