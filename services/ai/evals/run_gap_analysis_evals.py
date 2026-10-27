"""
Description: Runs the gap analysis evals (prompt builder, the real agent with its label checks,
and evidence mapping, exactly as the worker runs them) and reports the average of each score to
Logfire.
Run: docker compose run --rm ai python -m evals.run_gap_analysis_evals
Index:
    - EVAL_TODAY: the fixed "today" the cases are labelled against
    - load_gap_analysis_dataset: reads the YAML cases with the custom evaluators
    - run_gap_analysis_evals: evaluates every case, prints the report, scores the trace
"""

from datetime import date
from pathlib import Path

from pydantic_evals import Dataset
from pydantic_evals.reporting import EvaluationReport

from agents.gap_analysis_agent import analyze_gaps
from evals.gap_analysis_evaluators import GAP_ANALYSIS_EVALUATORS, GapAnalysisLabels
from evals.report_capture import override_settings
from evals.telemetry import evaluate_dataset
from gap_analysis.attach_evidence_text import attach_evidence_text
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from prompts.gap_analysis_instructions import GAP_ANALYSIS_PROMPT_VERSION
from schemas.gap_analysis import GapAnalysisResult
from schemas.gap_analysis_context import GapAnalysisContext
from settings import load_settings

DATASET_PATH = Path(__file__).parent / "datasets" / "gap_analysis_cases.yaml"
TRACE_NAME = "evals.gap_analysis"
EVAL_TODAY = date(2026, 10, 1)


def load_gap_analysis_dataset() -> Dataset[
    GapAnalysisContext, GapAnalysisResult, GapAnalysisLabels
]:
    """Loads the labelled gap analysis cases."""
    return Dataset[GapAnalysisContext, GapAnalysisResult, GapAnalysisLabels].from_file(
        DATASET_PATH, custom_evaluator_types=GAP_ANALYSIS_EVALUATORS
    )


def run_gap_analysis_evals(model_override: str | None = None) -> EvaluationReport:
    """Evaluates the agent on every case and records the average scores in Logfire."""
    settings = override_settings(load_settings(), "gap_analysis_model", model_override)
    model = settings.gap_analysis_model
    thinking = settings.gap_analysis_thinking

    def analyze_case(context: GapAnalysisContext) -> GapAnalysisResult:
        """The task under evaluation."""
        prompt = build_gap_analysis_prompt(context, EVAL_TODAY)
        run = analyze_gaps(
            prompt,
            model=model,
            thinking=thinking,
            timeout_seconds=settings.llm_run_timeout_seconds,
            fallback_model=settings.generative_fallback_model,
        )
        return attach_evidence_text(run.gap_analysis, prompt)

    return evaluate_dataset(
        load_gap_analysis_dataset,
        analyze_case,
        name=TRACE_NAME,
        metadata={
            "model": model,
            "thinking": thinking,
            "prompt_version": GAP_ANALYSIS_PROMPT_VERSION,
        },
        version=GAP_ANALYSIS_PROMPT_VERSION,
        tags=["eval", "analyze_gaps", model, f"thinking:{thinking}"],
        evaluation_name=f"gap_analysis:{model}:thinking={thinking}",
        max_concurrency=5,
    )


if __name__ == "__main__":
    run_gap_analysis_evals()
