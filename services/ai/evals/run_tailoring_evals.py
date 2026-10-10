"""
Description: Runs the tailoring evals for one section at a time and reports average scores
to Langfuse.
Run: docker compose run --rm ai python -m evals.run_tailoring_evals
Index:
    - load_tailoring_dataset: reads the YAML cases
    - run_tailoring_evals: evaluates every case
"""

from datetime import date
from pathlib import Path

from langfuse import get_client, propagate_attributes
from pydantic_evals import Dataset

from agents.resume_tailoring_agent import write_resume_section
from evals.tailoring_evaluators import TAILORING_EVALUATORS, TailorEvalInput, TailorEvalLabels
from prompts.resume_tailoring_instructions import RESUME_TAILORING_PROMPT_VERSION
from schemas.tailored_section import TailoredSectionDraft
from tailoring.build_section_prompt import build_section_prompt
from worker.settings import load_settings
from worker.tracing import configure_tracing

DATASET_PATH = Path(__file__).parent / "datasets" / "tailoring_cases.yaml"
TRACE_NAME = "evals.tailoring"


def load_tailoring_dataset() -> Dataset[TailorEvalInput, TailoredSectionDraft, TailorEvalLabels]:
    """Loads the labelled tailoring cases."""
    return Dataset[TailorEvalInput, TailoredSectionDraft, TailorEvalLabels].from_file(
        DATASET_PATH, custom_evaluator_types=TAILORING_EVALUATORS
    )


def run_tailoring_evals() -> None:
    """Evaluates the agent on every case and records the average scores in Langfuse."""
    settings = load_settings()
    configure_tracing()
    langfuse = get_client()
    model = settings.resume_tailoring_model
    thinking = settings.resume_tailoring_thinking

    def write_case(case: TailorEvalInput) -> TailoredSectionDraft:
        """The task under evaluation: one section, the whole library as sources."""
        prompt = build_section_prompt(
            case.section_type, case.context, [], [], None, write_anyway=False, gap_analysis=None, today=date(2026, 10, 1)
        )
        return write_resume_section(
            prompt,
            model=model,
            thinking=thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        ).draft

    with (
        langfuse.start_as_current_observation(
            name=TRACE_NAME,
            metadata={"model": model, "prompt_version": RESUME_TAILORING_PROMPT_VERSION},
        ),
        propagate_attributes(
            trace_name=TRACE_NAME,
            version=RESUME_TAILORING_PROMPT_VERSION,
            tags=["eval", "tailor_resume", model],
        ),
    ):
        report = load_tailoring_dataset().evaluate_sync(
            write_case, name=f"tailoring:{model}", max_concurrency=2
        )
        for score_name, average in report.averages().scores.items():
            langfuse.score_current_trace(name=score_name, value=average)

    report.print(include_input=False, include_output=False, include_durations=True)
    langfuse.flush()


if __name__ == "__main__":
    run_tailoring_evals()
