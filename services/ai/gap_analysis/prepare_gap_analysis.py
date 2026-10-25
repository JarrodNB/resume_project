"""Prepare one complete, screened comparison without dropping library evidence.

The job and entire library are required sources. Screen their readable text, then
rebuild the exact prompt from source snapshots for task-local coverage binding.
Failures retain all completed screening usage and never return a partial prompt.
"""

from dataclasses import dataclass
from datetime import date

import text_limits
from gap_analysis.build_gap_analysis_prompt import (
    GapAnalysisPrompt,
    build_gap_analysis_prompt,
    gap_job_input,
    gap_job_screening_text,
)
from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext, JobToAnalyze
from screening.job_fields import screen_job_fields
from screening.library_fields import screen_library_fields
from screening.prompt_guardrail import BLOCKED_MESSAGE, TOO_LONG_MESSAGE, UNCHECKED_MESSAGE
from screening.screen_user_text import screen_user_text
from screening.session import bind_screened_prompt
from worker.queue_messages import ModelUsage


@dataclass(frozen=True)
class PreparedGapAnalysis:
    """A ready prompt, or a user-visible failure, together with completed screen usage."""

    prompt: GapAnalysisPrompt | None
    usage: list[ModelUsage]
    error_message: str | None = None


def prepare_gap_analysis(
    context: GapAnalysisContext, *, today: date, screen_model: str, timeout_seconds: float,
) -> PreparedGapAnalysis:
    """Validate complete sources, screen job then library, and bind the exact rebuilt prompt."""
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
    job_screening_text = gap_job_screening_text(job_input)

    def render(values):
        return build_gap_analysis_prompt(GapAnalysisContext(
            job=JobToAnalyze.model_validate_json(values[0]),
            career_library=CareerLibrary.model_validate_json(values[1]),
        ), today=today)

    # Check the complete representation before spending on either required source.
    prompt = render(sources)
    if any(len(source) > text_limits.MAX_SCREENED_TEXT for source in sources) or len(job_screening_text) > text_limits.MAX_SCREENED_TEXT:
        return PreparedGapAnalysis(None, usage, TOO_LONG_MESSAGE)
    if text_limits.prompt_is_too_long(prompt.text):
        return PreparedGapAnalysis(None, usage, text_limits.GAP_PROMPT_TOO_LONG_MESSAGE)
    def check(source):
        outcome = screen_user_text(
            source, model=screen_model, timeout_seconds=timeout_seconds, check_phrases=False,
        )
        usage.extend(outcome.model_usages)
        return outcome

    outcome = screen_job_fields(context.job, check, approved_sources=[sources[0]])
    if outcome is not True and not outcome.allowed:
        message = TOO_LONG_MESSAGE if outcome.too_long else (
            UNCHECKED_MESSAGE if outcome.unchecked else BLOCKED_MESSAGE
        )
        return PreparedGapAnalysis(None, usage, message)
    outcome = screen_library_fields(context.career_library, check)
    if outcome is not True and not outcome.allowed:
        message = TOO_LONG_MESSAGE if outcome.too_long else (
            UNCHECKED_MESSAGE if outcome.unchecked else BLOCKED_MESSAGE
        )
        return PreparedGapAnalysis(None, usage, message)
    bind_screened_prompt(sources, lambda values: render(values).text)
    return PreparedGapAnalysis(prompt, usage)
