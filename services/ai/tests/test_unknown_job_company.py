"""Saved jobs can lack an employer without breaking screened prompts or retrieval.

The placeholder is presentation text; the shared job context keeps company as None.
"""

from datetime import date

from evals.library_retrieval_query import section_query
from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from schemas.gap_analysis_context import JobToAnalyze
from tests.fakes import build_gap_analysis_context


def test_unknown_company_survives_serialization_and_screened_prompt_builders():
    context = build_gap_analysis_context()
    context.job = JobToAnalyze.model_validate({**context.job.model_dump(), "company": None})
    # Gap analysis reconstructs its job from the screened JSON with absent optional fields.
    context.job = JobToAnalyze.model_validate_json(context.job.model_dump_json(exclude_none=True))
    gap = build_gap_analysis_prompt(context, date(2026, 10, 17))
    query = section_query("summary", context.job)
    for rendered in (gap.text, query):
        assert " at None" not in rendered
        assert " at null" not in rendered
        assert "Unknown company" in rendered
    assert context.job.company is None
