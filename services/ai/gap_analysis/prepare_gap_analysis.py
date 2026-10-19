"""Prepare one complete, screened comparison without dropping library evidence.

The job and entire library are required sources. Trusted saved records reuse complete
checks; temporary contexts screen per task. Rebuild the exact prompt from approved JSON
using the shared chunk policy and task-local coverage binding.
Failures retain all completed screening usage and never return a partial prompt.
"""

from dataclasses import dataclass
from datetime import date

import text_limits
from gap_analysis.build_gap_analysis_prompt import GapAnalysisPrompt, build_gap_analysis_prompt
from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext, JobToAnalyze
from screening.library_inputs import rebuild_library
from screening.prompt_guardrail import BLOCKED_MESSAGE, TOO_LONG_MESSAGE, UNCHECKED_MESSAGE
from screening.records import screen_record
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
    sources = (
        context.job.model_dump_json(exclude_none=True, exclude={"responsibilities"}),
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
    if context.job._screening_state is not None:
        return _prepare_saved_records(context, today, screen_model, timeout_seconds, usage)
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


def _prepare_saved_records(context, today, screen_model, timeout_seconds, usage):
    """Screen complete owning records; reconstruct the narrower generation context."""
    inputs = [(context.job.model_dump_json(exclude_none=True), context.job._screening_state)]
    fields = []
    library = context.career_library
    if library.summary and library.summary.strip():
        inputs.append((library.summary, library._summary_screening_state))
        fields.append("summary")
    for field in ("experiences", "projects", "educations", "certifications", "skills", "facts"):
        for record in getattr(library, field):
            inputs.append((record.model_dump_json(exclude_none=True), record._screening_state))
            fields.append(field)
    if any(len(source) > text_limits.MAX_SCREENED_TEXT for source, _state in inputs):
        return PreparedGapAnalysis(None, usage, TOO_LONG_MESSAGE)
    for source, state in inputs:
        outcome = screen_record(source, state, model=screen_model, timeout_seconds=timeout_seconds)
        usage.extend(outcome.model_usages)
        if not outcome.allowed:
            message = TOO_LONG_MESSAGE if outcome.too_long else (
                UNCHECKED_MESSAGE if outcome.unchecked else BLOCKED_MESSAGE
            )
            return PreparedGapAnalysis(None, usage, message)

    def render(values):
        job = JobToAnalyze.model_validate_json(values[0])
        job.responsibilities = []
        return build_gap_analysis_prompt(GapAnalysisContext(
            job=job, career_library=rebuild_library(values[1:], fields),
        ), today=today)

    sources = [source for source, _state in inputs]
    prompt = render(sources)
    bind_screened_prompt(sources, lambda values: render(values).text)
    return PreparedGapAnalysis(prompt, usage)
