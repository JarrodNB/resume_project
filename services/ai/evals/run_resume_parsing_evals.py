"""
Description: Runs the resume parsing evals against the real model and reports the average of
each score to Logfire (one trace per run, agent calls nested inside).
Run: docker compose run --rm ai python -m evals.run_resume_parsing_evals
Index:
    - load_resume_parsing_dataset: reads the YAML cases with the custom evaluators
    - run_resume_parsing_evals: evaluates allowed parsing cases, prints and scores the report
"""

from pathlib import Path
from typing import Any

from pydantic_evals import Dataset
from pydantic_evals.reporting import EvaluationReport

from agents.resume_parsing_agent import parse_resume_text
from evals.report_capture import override_settings
from evals.resume_parsing_evaluators import RESUME_PARSING_EVALUATORS
from evals.telemetry import evaluate_dataset
from prompts.resume_parsing_instructions import RESUME_PARSING_PROMPT_VERSION
from schemas.parsed_resume import ParsedResume
from worker.settings import load_settings

DATASET_PATH = Path(__file__).parent / "datasets" / "resume_parsing_cases.yaml"
TRACE_NAME = "evals.resume_parsing"


def load_resume_parsing_dataset() -> Dataset[str, ParsedResume, dict[str, Any]]:
    """Loads the labelled resume parsing cases."""
    return Dataset[str, ParsedResume, dict[str, Any]].from_file(
        DATASET_PATH, custom_evaluator_types=RESUME_PARSING_EVALUATORS
    )


def run_resume_parsing_evals(model_override: str | None = None) -> EvaluationReport:
    """Evaluates allowed parsing cases; expected blocks run in the guardrail suite."""
    settings = override_settings(load_settings(), "resume_parsing_model", model_override)
    model = settings.resume_parsing_model
    thinking = settings.resume_parsing_thinking

    def parse_case(resume_text: str) -> ParsedResume:
        """The task under evaluation."""
        return parse_resume_text(
            resume_text,
            model=model,
            thinking=thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        ).parsed_resume

    dataset = load_resume_parsing_dataset()
    # Expected rejections are measured by run_prompt_guardrail_evals, never bypassed here.
    dataset.cases = [
        case for case in dataset.cases if not (case.metadata or {}).get("expects_input_block")
    ]
    return evaluate_dataset(
        lambda: dataset,
        parse_case,
        name=TRACE_NAME,
        metadata={
            "model": model,
            "thinking": thinking,
            "prompt_version": RESUME_PARSING_PROMPT_VERSION,
        },
        version=RESUME_PARSING_PROMPT_VERSION,
        tags=["eval", "parse_resume", model, f"thinking:{thinking}"],
        evaluation_name=f"resume_parsing:{model}:thinking={thinking}",
        max_concurrency=5,
    )


if __name__ == "__main__":
    run_resume_parsing_evals()
