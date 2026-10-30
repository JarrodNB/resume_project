"""Prepare one complete, screened comparison without dropping library evidence.

The job and entire library are required sources. Their unchecked readable fields are
screened together in one `screen_records` call, then the exact prompt is rebuilt from
source snapshots for task-local coverage binding. Failures retain all completed
screening usage and never return a partial prompt.
"""

from dataclasses import dataclass
from datetime import date

import text_limits
from gap_analysis.build_gap_analysis_prompt import (
    GapAnalysisPrompt,
    build_gap_analysis_prompt,
    gap_job_input,
)
from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext, JobToAnalyze
from schemas.model_usage import ModelUsage
from screening.prompt_guardrail import TOO_LONG_MESSAGE
from screening.record_adapters import job_records, library_records
from screening.records import record_failure_message, screen_records_sync
from screening.session import bind_screened_prompt


@dataclass(frozen=True)
class PreparedGapAnalysis:
    """A ready prompt, or a user-visible failure, together with completed screen usage."""

    prompt: GapAnalysisPrompt | None
    usage: list[ModelUsage]
    error_message: str | None = None


def prepare_gap_analysis(
    context: GapAnalysisContext, *, today: date, screen_model: str, timeout_seconds: float,
) -> PreparedGapAnalysis:
    """Validate complete sources, screen job and library together, and bind the exact prompt.

    `screen_model` and `timeout_seconds` are kept for callers; record screening uses the
    configured classifier and the task deadline.
    """
    job_input = gap_job_input(context.job)
    selected_job = JobToAnalyze(
        id=context.job.id, title=job_input.title, company=job_input.company,
        requirements=list(job_input.requirements), nice_to_haves=list(job_input.nice_to_haves),
    )
    sources = (
        selected_job.model_dump_json(exclude_none=True, exclude={"responsibilities"}),
        context.career_library.model_dump_json(exclude_none=True),
    )
    usage: list[ModelUsage] = []

    def render(values):
        return build_gap_analysis_prompt(GapAnalysisContext(
            job=JobToAnalyze.model_validate_json(values[0]),
            career_library=CareerLibrary.model_validate_json(values[1]),
        ), today=today)

    # Check the complete representation before spending on either required source.
    prompt = render(sources)
    if any(len(source) > text_limits.MAX_SCREENED_TEXT for source in sources):
        return PreparedGapAnalysis(None, usage, TOO_LONG_MESSAGE)
    if text_limits.prompt_is_too_long(prompt.text):
        return PreparedGapAnalysis(None, usage, text_limits.GAP_PROMPT_TOO_LONG_MESSAGE)
    # The prompt uses only these job fields and every library field.
    records = [*job_records(context.job), *library_records(context.career_library)]
    outcome = screen_records_sync(records, approved_sources=sources)
    usage.extend(outcome.decision.model_usages)
    if not outcome.allowed:
        return PreparedGapAnalysis(None, usage, record_failure_message(outcome))
    bind_screened_prompt(sources, lambda values: render(values).text)
    return PreparedGapAnalysis(prompt, usage)
