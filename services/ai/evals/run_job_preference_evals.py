"""Run one bounded synthetic JEV preference experiment through the production worker.

Run python -m evals.run_job_preference_evals. This invokes real screening and decision
providers, incurs charges, prints case outcomes/costs, and writes no report files.
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
    expand_preference_decision,
)
from evals.telemetry import evaluate_dataset
from llm.usage import collect_task_usage
from prompts.job_preference_instructions import JOB_PREFERENCE_PROMPT_VERSION
from settings import load_settings
from worker.job_preference_handler import handle_job_preference_check_task


def load_job_preference_dataset():
    return Dataset[PreferenceEvalInput, PreferenceEvalOutput, PreferenceEvalLabels].from_file(
        Path(__file__).parent / "datasets/job_preference_cases.yaml", custom_evaluator_types=(PreferenceOutcome,))


def run_job_preference_evals():
    """One run, eight cases, serial execution; failures remain visible rather than retried."""
    settings = load_settings()
    costs = []
    def assess(case):
        task = SimpleNamespace(ai_task_id=uuid4(), input={"profile_id": str(uuid4()), "confirmed_revision": 1,
            "criteria": [{"id": str(uuid4()), "text": case.criterion, "priority": "must_have"}],
            "listings": [{"id": str(uuid4()), "source_digest": "a" * 64, "truncated": False,
                "passages": [{"id": f"P{i + 1}", "text": text} for i, text in enumerate(case.passages)]}]})
        with collect_task_usage() as usage:
            try:
                result = handle_job_preference_check_task(task, SimpleNamespace(settings=settings))
            finally:
                costs.append({"requests_with_usage": len(usage.entries),
                    "input_tokens": sum(e.input_tokens for e in usage.entries),
                    "output_tokens": sum(e.output_tokens for e in usage.entries),
                    "cost_microdollars": sum(e.cost_microdollars or 0 for e in usage.entries),
                    "usage_incomplete": usage.incomplete})
        listing = result.result["listings"][0] if result.status == "completed" else None
        decision = expand_preference_decision(listing, listing["criteria"][0]) if listing else None
        return PreferenceEvalOutput(status=result.status, decision=decision,
            failure_code=result.result.get("failure_code") if result.result else None)
    report = evaluate_dataset(load_job_preference_dataset, assess,
        name="evals.job_preferences", evaluation_name="job_preferences:jev-1.13.0",
        metadata={"model": JEV_PREFERENCE_MODEL, "prompt_version": JOB_PREFERENCE_PROMPT_VERSION,
            "screening": "production", "run_count": 1}, version=JOB_PREFERENCE_PROMPT_VERSION,
        tags=["eval", "job_preferences", JEV_PREFERENCE_MODEL], max_concurrency=1)
    for case in report.cases:
        print(case.name, case.output.model_dump())
    print("Preference evaluation provider accounting:", json.dumps(costs))
    if report.failures or any(case.evaluator_failures or any(case.scores.get(key) is None or case.scores[key].value < 1
        for key in ("decision_match", "evidence_valid")) for case in report.cases):
        raise RuntimeError("Preference evaluation has execution errors or incorrect decisions/evidence")
    return report


class BatchSmokeOutcome(Evaluator):
    """Judge one small batch's fixed outcomes, exact evidence and preference ordering."""
    def evaluate(self, ctx):
        return {"decision_match": float(ctx.output["decisions"] == ctx.metadata["decisions"]),
            "evidence_valid": float(ctx.output["evidence_valid"]),
            "order_match": float(ctx.output["order"] == ctx.metadata["order"])}


def load_job_preference_batch_smoke_dataset():
    """Three synthetic postings share three criteria; expected labels never reach the model."""
    return Dataset(name="job-preference-batch-smoke", cases=[Case(name="three-listing-batch", inputs={
        "criteria": [("Fully remote work with no required office days", "must_have"),
            ("Annual salary of at least USD 150000", "must_have"), ("Work for a climate technology company", "nice_to_have")],
        "listings": [
            ("strong", "This job is fully remote with no office visits. The annual salary is USD 160000. Our company builds climate technology."),
            ("conflict", "This position requires five days a week in our Boston office. The annual salary is USD 140000. Our company does not work on climate technology."),
            ("unknown", "We are hiring an engineer to build useful software. Contact our recruiting team for further details."),
        ]}, metadata={"decisions": [["matching"] * 3, ["conflicting"] * 3, ["unknown"] * 3],
            "order": ["strong", "unknown", "conflict"]})], evaluators=[BatchSmokeOutcome()])


def run_job_preference_batch_smoke():
    """Run exactly one three-by-three production-screening check, with no tuning or retries."""
    settings = load_settings()
    costs = []
    def assess(case):
        task = SimpleNamespace(ai_task_id=uuid4(), input={"profile_id": str(uuid4()), "confirmed_revision": 1,
            "criteria": [{"id": str(uuid4()), "text": text, "priority": priority} for text, priority in case["criteria"]],
            "listings": [{"id": str(uuid4()), "source_digest": "a" * 64, "truncated": False,
                "passages": [{"id": "P1", "text": text}]} for _, text in case["listings"]]})
        started = monotonic()
        with collect_task_usage() as usage:
            try:
                result = handle_job_preference_check_task(task, SimpleNamespace(settings=settings))
            finally:
                costs.append({"elapsed_seconds": round(monotonic() - started, 3), "requests_with_usage": len(usage.entries),
                    "input_tokens": sum(e.input_tokens for e in usage.entries), "output_tokens": sum(e.output_tokens for e in usage.entries),
                    "cost_microdollars": sum(e.cost_microdollars or 0 for e in usage.entries), "usage_incomplete": usage.incomplete})
        if result.status != "completed":
            raise RuntimeError("The batch smoke did not complete")
        decisions = [[c["status"] for c in item["criteria"]] for item in result.result["listings"]]
        evidence_valid = all(all(quote["text"] == source["passages"][int(quote["passage_id"][1:]) - 1]["text"]
            for quote in item["evidence_passages"]) for item, source in zip(result.result["listings"], task.input["listings"], strict=True))
        def score(index):
            statuses = decisions[index]
            return (statuses[:2].count("conflicting"), statuses[:2].count("unknown"), -statuses[2:].count("matching"), statuses[2:].count("conflicting"), index)
        order = [case["listings"][index][0] for index in sorted(range(len(decisions)), key=score)]
        return {"decisions": decisions, "evidence_valid": evidence_valid, "order": order}
    report = evaluate_dataset(load_job_preference_batch_smoke_dataset, assess, name="evals.job_preferences.batch_smoke",
        evaluation_name="job_preferences:batch_smoke", metadata={"model": JEV_PREFERENCE_MODEL,
            "prompt_version": JOB_PREFERENCE_PROMPT_VERSION, "screening": "production", "run_count": 1},
        version=JOB_PREFERENCE_PROMPT_VERSION, max_concurrency=1)
    print("Batch smoke provider accounting:", json.dumps(costs))
    for case in report.cases:
        print(case.name, case.output)
    if report.failures or any(case.evaluator_failures or any(case.scores.get(key) is None or case.scores[key].value < 1
        for key in ("decision_match", "evidence_valid", "order_match")) for case in report.cases):
        raise RuntimeError("Preference batch smoke has execution errors or incorrect outcomes")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-smoke", action="store_true", help="Run one bounded three-listing/three-criterion check instead of the full suite")
    args = parser.parse_args()
    run_job_preference_batch_smoke() if args.batch_smoke else run_job_preference_evals()
