"""Prepare one complete, screened comparison without dropping library evidence.

The job and every entry in the complete library are required sources. Rebuild the exact prompt from their
approved JSON, using shared source units, screening policy, and exact coverage binding.
Failures retain all completed screening usage and never return a partial prompt.
"""

from dataclasses import dataclass
from datetime import date

import text_limits
from gap_analysis.build_gap_analysis_prompt import GapAnalysisPrompt, build_gap_analysis_prompt
from schemas.gap_analysis_context import GapAnalysisContext
from screening.job_inputs import job_source_values, rebuild_job
from screening.library_inputs import library_source_values, rebuild_library
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
    library = library_source_values(context.career_library)
    sources = (*job_source_values(context.job), *library.sources)
    usage: list[ModelUsage] = []

    def render(values):
        return build_gap_analysis_prompt(GapAnalysisContext(
            job=rebuild_job(values[:1]),
            career_library=rebuild_library(values[1:], library.fields),
        ), today=today)

    # Check the complete representation before spending on either required source.
    prompt = render(sources)
    if (len(context.career_library.model_dump_json(exclude_none=True)) > text_limits.MAX_SCREENED_TEXT
            or any(len(source) > text_limits.MAX_SCREENED_TEXT for source in sources)):
        return PreparedGapAnalysis(None, usage, TOO_LONG_MESSAGE)
    if text_limits.prompt_is_too_long(prompt.text):
        return PreparedGapAnalysis(None, usage, text_limits.GAP_PROMPT_TOO_LONG_MESSAGE)
    for source in sources:
        outcome = screen_user_text(
            source, model=screen_model, timeout_seconds=timeout_seconds, check_phrases=False,
        )
        usage.extend(outcome.model_usages)
        if not outcome.allowed:
            message = TOO_LONG_MESSAGE if outcome.too_long else (
                UNCHECKED_MESSAGE if outcome.unchecked else BLOCKED_MESSAGE
            )
            return PreparedGapAnalysis(None, usage, message)
    bind_screened_prompt(sources, lambda values: render(values).text)
    return PreparedGapAnalysis(prompt, usage)
