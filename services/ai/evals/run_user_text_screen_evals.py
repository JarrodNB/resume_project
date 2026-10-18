"""
Description: Runs the Jev user-text screen evals and reports average scores to Logfire.
The task is the Jev call itself (screen_user_message), not the phrase list in front of it.
Run: docker compose run --rm ai python -m evals.run_user_text_screen_evals
Index:
    - load_user_text_screen_dataset: reads the YAML cases
    - run_user_text_screen_evals: evaluates every case
"""

from pathlib import Path

from pydantic_evals import Dataset
from pydantic_evals.reporting import EvaluationReport

from agents.user_text_screen_agent import screen_user_message
from evals.report_capture import override_settings
from evals.telemetry import evaluate_dataset, record_average_scores, record_score
from evals.user_text_screen_evaluators import (
    USER_TEXT_SCREEN_EVALUATORS,
    UserTextScreenEvalInput,
    UserTextScreenEvalLabels,
    UserTextScreenEvalOutput,
)
from prompts.user_text_screen_instructions import USER_TEXT_SCREEN_PROMPT_VERSION
from worker.settings import load_settings

DATASET_PATH = Path(__file__).parent / "datasets" / "user_text_screen_cases.yaml"
TRACE_NAME = "evals.user_text_screen"


def load_user_text_screen_dataset() -> Dataset[
    UserTextScreenEvalInput, UserTextScreenEvalOutput, UserTextScreenEvalLabels
]:
    """Loads the labelled screen cases."""
    return Dataset[
        UserTextScreenEvalInput, UserTextScreenEvalOutput, UserTextScreenEvalLabels
    ].from_file(DATASET_PATH, custom_evaluator_types=USER_TEXT_SCREEN_EVALUATORS)


def run_user_text_screen_evals(model_override: str | None = None) -> EvaluationReport:
    """Evaluates Jev on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "user_text_screen_model", model_override)
    model = settings.user_text_screen_model

    def judge_case(case: UserTextScreenEvalInput) -> UserTextScreenEvalOutput:
        """The task under evaluation: one Jev call, with its reported margins."""
        run = screen_user_message(
            case.text, model=model, timeout_seconds=settings.llm_run_timeout_seconds
        )
        return UserTextScreenEvalOutput(screen=run.screen, confidence=run.confidence)

    def score_report(report):
        """Keep outages visible even when no successful cases can produce averages."""
        if report.cases:
            record_average_scores(report)
        record_score(name="case_errors", value=len(report.failures))

    report = evaluate_dataset(
        load_user_text_screen_dataset,
        judge_case,
        name=TRACE_NAME,
        metadata={"model": model, "prompt_version": USER_TEXT_SCREEN_PROMPT_VERSION},
        version=USER_TEXT_SCREEN_PROMPT_VERSION,
        tags=["eval", "user_text_screen", model],
        evaluation_name=f"user_text_screen:{model}",
        max_concurrency=4, score_report=score_report,
    )
    if report.failures or any(
        case.evaluator_failures or "decision_match" not in case.scores
        or case.scores["decision_match"].value < 1
        for case in report.cases
    ):
        raise RuntimeError("JEV screening evaluation contained errors or incorrect decisions")
    return report


if __name__ == "__main__":
    run_user_text_screen_evals()
