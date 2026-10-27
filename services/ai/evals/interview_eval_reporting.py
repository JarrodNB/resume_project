"""
Description: Runs interview datasets with quality judges and Logfire aggregate reporting.
Index:
    - report_interview_evals: evaluates, prints errors/scores, flushes trace reporting
    - count_errors: counts native task, case-evaluator and report-evaluator failures
    - InterviewJudge: evaluates all applicable rubrics in one provider attempt
"""

from evals.interview_judge import InterviewJudge
from evals.telemetry import evaluate_dataset, record_average_scores, record_score
from prompts.interview_judge_instructions import INTERVIEW_JUDGE_PROMPT_VERSION
from settings import load_settings


def report_interview_evals(
    dataset, task, name: str, model: str, version: str, rubrics: dict, *, settings=None,
) -> None:
    """Adds one independent input-aware judge and records each average score."""
    settings = settings or load_settings()
    def prepare_judges():
        """Install judges after tracing is configured, before evaluation begins."""
        if rubrics:
            dataset.add_evaluator(InterviewJudge(
                rubrics, settings.eval_judge_model, settings.llm_run_timeout_seconds))

    def score_report(report):
        """Keep interview averages and all three native error categories."""
        record_average_scores(report)
        record_score(name="case_errors", value=count_errors(report))

    report = evaluate_dataset(
        lambda: dataset, task,
        name=name,
        metadata={"model": model, "judge_model": settings.eval_judge_model, "prompt_version": version,
                  "judge_prompt_version": INTERVIEW_JUDGE_PROMPT_VERSION,
                  "judge_attempt_limit": 1,
                  "judge_rubrics": rubrics, "judge_include_input": True,
                  "judge_include_reason": True},
        version=version,
        tags=["eval", name, model],
        evaluation_name=f"{name}:{model}", max_concurrency=2,
        prepare=prepare_judges, score_report=score_report,
        print_options={"include_input": False, "include_output": True,
                       "include_durations": True, "include_reasons": True},
    )
    errors = count_errors(report)
    for case in report.cases:
        print(f"{case.name} output JSON: {case.output.model_dump_json()}")
    if errors:
        raise RuntimeError(f"{errors} interview case or evaluator errors")


def count_errors(report):
    """Count native task, case-evaluator and report-evaluator failures."""
    return (len(report.failures) + len(report.report_evaluator_failures)
            + sum(len(case.evaluator_failures) for case in report.cases))
