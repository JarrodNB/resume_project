"""Evaluate the isolated importer against synthetic mixed-model and placement cases.

Run explicitly with Docker; real-provider evaluations incur provider charges. Outputs
are restored within the same privacy scope before deterministic scoring and Logfire reports.
"""

from pathlib import Path

from pydantic_evals import Dataset

from evals.report_capture import override_settings
from evals.report_markdown import report_errors
from evals.resume_import_evaluators import UnassignedPlacement
from evals.resume_parsing_evaluators import RESUME_PARSING_EVALUATORS
from evals.telemetry import evaluate_dataset
from prompts.resume_import_instructions import RESUME_IMPORT_PROMPT_VERSION
from resume_import import import_resume_text
from schemas.parsed_resume import ParsedResume
from screening.session import screening_session
from worker.contact_mask import import_privacy_scope
from worker.settings import load_settings

DATASET_PATH = Path(__file__).parent / "datasets" / "resume_import_cases.yaml"


def load_resume_import_dataset() -> Dataset[str, ParsedResume, dict]:
    """Load only synthetic source documents and evaluation-only expected results."""
    return Dataset[str, ParsedResume, dict].from_file(
        DATASET_PATH,
        custom_evaluator_types=(*RESUME_PARSING_EVALUATORS, UnassignedPlacement),
    )


def run_resume_import_evals(model_override: str | None = None, *, max_concurrency: int = 1):
    """Run the same screened, bounded entry point used by the future handler swap."""
    settings = override_settings(load_settings(), "resume_parsing_model", model_override)

    def parse_case(text: str) -> ParsedResume:
        with import_privacy_scope() as privacy, screening_session(settings.llm_run_timeout_seconds):
            run = import_resume_text(
                privacy.prepare(text),
                settings.resume_parsing_model,
                settings.resume_parsing_thinking,
                settings.llm_run_timeout_seconds,
                settings.generative_fallback_model,
            )
            return privacy.restore(run.parsed_resume)

    return evaluate_dataset(
        load_resume_import_dataset,
        parse_case,
        name="evals.resume_import",
        metadata={
            "model": settings.resume_parsing_model,
            "thinking": settings.resume_parsing_thinking,
            "prompt_version": RESUME_IMPORT_PROMPT_VERSION,
        },
        version=RESUME_IMPORT_PROMPT_VERSION,
        tags=["eval", "resume_import", settings.resume_parsing_model],
        evaluation_name=f"resume_import:{settings.resume_parsing_model}",
        max_concurrency=max_concurrency,
    )


def main() -> int:
    """Signal execution/evaluator errors to CLI callers without grading quality scores."""
    return int(bool(report_errors(run_resume_import_evals())))


if __name__ == "__main__":
    raise SystemExit(main())
