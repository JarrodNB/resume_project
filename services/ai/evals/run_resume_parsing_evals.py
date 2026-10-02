"""
Description: Runs the resume parsing evals against the real model and reports the average of
each score to Langfuse (one trace per run, agent calls nested inside).
Run: docker compose run --rm ai python -m evals.run_resume_parsing_evals
Index:
    - load_resume_parsing_dataset: reads the YAML cases with the custom evaluators
    - run_resume_parsing_evals: evaluates every case, prints the report, and scores the trace
"""

from pathlib import Path
from typing import Any

from langfuse import get_client, propagate_attributes
from pydantic_evals import Dataset

from agents.resume_parsing_agent import parse_resume_text
from evals.resume_parsing_evaluators import RESUME_PARSING_EVALUATORS
from schemas.parsed_resume import ParsedResume
from worker.settings import load_settings
from worker.tracing import configure_tracing

DATASET_PATH = Path(__file__).parent / "datasets" / "resume_parsing_cases.yaml"
TRACE_NAME = "evals.resume_parsing"


def load_resume_parsing_dataset() -> Dataset[str, ParsedResume, dict[str, Any]]:
    """Loads the labelled resume parsing cases."""
    return Dataset[str, ParsedResume, dict[str, Any]].from_file(
        DATASET_PATH, custom_evaluator_types=RESUME_PARSING_EVALUATORS
    )


def run_resume_parsing_evals() -> None:
    """Evaluates the agent on every case and records the average scores in Langfuse."""
    settings = load_settings()
    configure_tracing()
    langfuse = get_client()
    model = settings.resume_parsing_model

    def parse_case(resume_text: str) -> ParsedResume:
        """The task under evaluation."""
        return parse_resume_text(
            resume_text, model=model, timeout_seconds=settings.llm_run_timeout_seconds
        ).parsed_resume

    with (
        langfuse.start_as_current_observation(name=TRACE_NAME, metadata={"model": model}),
        propagate_attributes(trace_name=TRACE_NAME, tags=["eval", "parse_resume", model]),
    ):
        report = load_resume_parsing_dataset().evaluate_sync(
            parse_case, name=f"resume_parsing:{model}", max_concurrency=5
        )
        for score_name, average in report.averages().scores.items():
            langfuse.score_current_trace(name=score_name, value=average)

    report.print(include_input=False, include_output=False, include_durations=True)
    langfuse.flush()


if __name__ == "__main__":
    run_resume_parsing_evals()
