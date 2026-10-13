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

from agents.user_text_screen_agent import screen_user_message
from evals.report_capture import capture_report, override_settings
from evals.telemetry import eval_run, record_score
from evals.user_text_screen_evaluators import (
    USER_TEXT_SCREEN_EVALUATORS,
    UserTextScreenEvalInput,
    UserTextScreenEvalLabels,
    UserTextScreenEvalOutput,
)
from prompts.user_text_screen_instructions import USER_TEXT_SCREEN_PROMPT_VERSION
from worker.settings import load_settings
from worker.tracing import configure_tracing

DATASET_PATH = Path(__file__).parent / "datasets" / "user_text_screen_cases.yaml"
TRACE_NAME = "evals.user_text_screen"


def load_user_text_screen_dataset() -> Dataset[
    UserTextScreenEvalInput, UserTextScreenEvalOutput, UserTextScreenEvalLabels
]:
    """Loads the labelled screen cases."""
    return Dataset[
        UserTextScreenEvalInput, UserTextScreenEvalOutput, UserTextScreenEvalLabels
    ].from_file(DATASET_PATH, custom_evaluator_types=USER_TEXT_SCREEN_EVALUATORS)


def run_user_text_screen_evals(model_override: str | None = None) -> None:
    """Evaluates Jev on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "user_text_screen_model", model_override)
    configure_tracing()
    model = settings.user_text_screen_model

    def judge_case(case: UserTextScreenEvalInput) -> UserTextScreenEvalOutput:
        """The task under evaluation: one Jev call, with its reported margins."""
        run = screen_user_message(
            case.text, model=model, timeout_seconds=settings.llm_run_timeout_seconds
        )
        return UserTextScreenEvalOutput(screen=run.screen, confidence=run.confidence)

    with eval_run(
        name=TRACE_NAME,
        metadata={"model": model, "prompt_version": USER_TEXT_SCREEN_PROMPT_VERSION},
        version=USER_TEXT_SCREEN_PROMPT_VERSION,
        tags=["eval", "user_text_screen", model],
    ):
        report = load_user_text_screen_dataset().evaluate_sync(
            judge_case, name=f"user_text_screen:{model}", max_concurrency=4
        )
        capture_report(report)
        for score_name, average in report.averages().scores.items():
            record_score(name=score_name, value=average)

    report.print(include_input=False, include_output=False, include_durations=True)


if __name__ == "__main__":
    run_user_text_screen_evals()
