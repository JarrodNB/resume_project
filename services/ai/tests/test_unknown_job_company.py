"""Saved jobs can lack an employer without breaking screened prompts or retrieval.

The placeholder is presentation text; the shared job context keeps company as None.
"""

from datetime import date

from gap_analysis.build_gap_analysis_prompt import build_gap_analysis_prompt
from schemas.gap_analysis_context import JobToAnalyze
from screening.screen_user_text import ScreenOutcome
from screening.session import screening_session
from tailoring.build_section_prompt import build_section_prompt
from tailoring.retrieve_for_section import section_query
from tests.fakes import build_gap_analysis_context


def test_unknown_company_survives_serialization_and_screened_prompt_builders():
    context = build_gap_analysis_context()
    context.job = JobToAnalyze.model_validate({**context.job.model_dump(), "company": None})
    # Gap analysis reconstructs its job from the screened JSON with absent optional fields.
    context.job = JobToAnalyze.model_validate_json(context.job.model_dump_json(exclude_none=True))
    seen = []

    def allow(text):
        seen.append(text)
        return ScreenOutcome(allowed=True)

    with screening_session():
        gap = build_gap_analysis_prompt(context, date(2026, 10, 17))
        section = build_section_prompt("summary", context, [], [], None,
            write_anyway=False, gap_analysis=None, allow_text=allow)

    for rendered in [gap.text, section.text, section_query("summary", context.job), *seen]:
        assert " at None" not in rendered
        assert " at null" not in rendered
    assert "Unknown company" in gap.text
    assert "Unknown company" in section.text
    assert "Unknown company" in section_query("summary", context.job)
    assert context.job.company is None
