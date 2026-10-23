"""Measure the four production resume writers on synthetic section cases.

Summary, experience, projects, and skill selection use the real section agent and report
scores to Logfire. Contact and credential copying have deterministic offline checks;
this suite does not generate them or measure whole-draft execution latency. Paired rich
experience cases exercise page-choice guidance and distinct supported evidence coverage.
"""

from datetime import date
from pathlib import Path

from pydantic_evals import Dataset
from pydantic_evals.reporting import EvaluationReport

from agents.resume_tailoring_agent import write_resume_section
from evals.report_capture import override_settings
from evals.tailoring_evaluators import TAILORING_EVALUATORS, TailorEvalInput, TailorEvalLabels
from evals.telemetry import evaluate_dataset
from prompts.resume_tailoring_instructions import RESUME_TAILORING_PROMPT_VERSION
from schemas.tailored_section import TailoredSectionDraft
from tailoring.build_section_prompt import build_section_prompt
from worker.settings import load_settings

DATASET_PATH = Path(__file__).parent / "datasets" / "tailoring_cases.yaml"
TRACE_NAME = "evals.tailoring"


def load_tailoring_dataset() -> Dataset[TailorEvalInput, TailoredSectionDraft, TailorEvalLabels]:
    """Loads the labelled tailoring cases."""
    return Dataset[TailorEvalInput, TailoredSectionDraft, TailorEvalLabels].from_file(
        DATASET_PATH, custom_evaluator_types=TAILORING_EVALUATORS
    )


def run_tailoring_evals(model_override: str | None = None) -> EvaluationReport:
    """Evaluates the agent on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "resume_tailoring_model", model_override)
    model = settings.resume_tailoring_model
    thinking = settings.resume_tailoring_thinking

    def write_case(case: TailorEvalInput) -> TailoredSectionDraft:
        """The task under evaluation: one section, the whole library as sources."""
        prompt = build_section_prompt(
            case.section_type,
            case.context,
            [],
            [],
            None,
            write_anyway=False,
            gap_analysis=None,
            today=date(2026, 10, 1),
            target_page_count=case.target_page_count,
            word_allowance=case.word_allowance,
        )
        return write_resume_section(
            prompt,
            model=model,
            thinking=thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        ).draft

    return evaluate_dataset(
        load_tailoring_dataset,
        write_case,
        name=TRACE_NAME,
        metadata={"model": model, "prompt_version": RESUME_TAILORING_PROMPT_VERSION},
        version=RESUME_TAILORING_PROMPT_VERSION,
        tags=["eval", "tailor_resume", model],
        evaluation_name=f"tailoring:{model}",
        max_concurrency=2,
    )


if __name__ == "__main__":
    run_tailoring_evals()
