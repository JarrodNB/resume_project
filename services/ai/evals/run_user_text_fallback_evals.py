"""Evaluate Nano's prompt-injection classifier on shared synthetic cases.

Boolean decisions use the production policy. Outages remain case errors, and no JEV
confidence margins are invented. Run with python -m evals.run_user_text_fallback_evals.
"""

from pydantic_evals import Case, Dataset

from agents.user_text_fallback_agent import screen_fallback_message
from evals.run_user_text_screen_evals import load_user_text_screen_dataset
from evals.telemetry import evaluate_dataset, record_score
from prompts.user_text_fallback_instructions import USER_TEXT_FALLBACK_PROMPT_VERSION
from schemas.user_text_fallback import UserTextFallbackScreen
from worker.settings import load_settings

NANO_MODEL = "openai:gpt-5-nano"


def load_user_text_fallback_dataset():
    """Reuse labeled messages, with a separate boolean task and no confidence evaluators."""
    return Dataset(name="user-text-fallback", cases=[
        Case(name=case.name, inputs=case.inputs, metadata=case.metadata)
        for case in load_user_text_screen_dataset().cases
    ])


def run_user_text_fallback_evals():
    """Report decision and injection accuracy and fail visibly on case errors."""
    settings = load_settings()
    model = NANO_MODEL

    def classify(case) -> UserTextFallbackScreen:
        timeout = min(settings.llm_run_timeout_seconds, settings.user_text_screen_timeout_seconds)
        return screen_fallback_message(case.text, model, timeout).screen

    def score(report):
        total = len(report.cases)
        for name, matches in {
            "decision_match": sum(case.output.blocked == case.metadata.block for case in report.cases),
            "prompt_injection_match": sum(case.output.prompt_injection == case.metadata.prompt_injection
                                          for case in report.cases),
        }.items():
            record_score(name=name, value=matches / total if total else 0)
        record_score(name="case_errors", value=len(report.failures))

    report = evaluate_dataset(
        load_user_text_fallback_dataset, classify,
        name="evals.user_text_fallback", max_concurrency=4,
        metadata={"model": model, "prompt_version": USER_TEXT_FALLBACK_PROMPT_VERSION},
        version=USER_TEXT_FALLBACK_PROMPT_VERSION, tags=["eval", "user_text_fallback", model],
        evaluation_name=f"user_text_fallback:{model}", score_report=score,
        print_options={"include_input": False, "include_output": True},
    )
    if report.failures or any(case.output.blocked != case.metadata.block for case in report.cases):
        raise RuntimeError("Fallback screening evaluation contained errors or incorrect decisions")
    return report


if __name__ == "__main__":
    run_user_text_fallback_evals()
