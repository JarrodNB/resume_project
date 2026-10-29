"""Run one bounded synthetic JEV preference experiment through the production worker.

Run python -m evals.run_job_preference_evals. This invokes real screening and decision
providers, incurs charges, prints case outcomes/costs, and writes no report files.
"""
import json
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

from pydantic_evals import Dataset

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
        decision = result.result["listings"][0]["criteria"][0] if result.status == "completed" else None
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


if __name__ == "__main__":
    run_job_preference_evals()
