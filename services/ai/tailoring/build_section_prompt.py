"""Build a section prompt from the job and labeled career evidence.

The summary can reuse selected generated/copied section snapshots after screening.
Exact prompt binding shares only current-execution source approvals with the guardrail.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime

from model_inputs.tailoring import TailoringSectionInput, format_tailoring_section_input
from schemas.certification_dates import certification_expiry_status
from schemas.gap_analysis_context import GapAnalysisContext
from schemas.gap_response import GapResponseSnapshot
from screening.session import bind_screened_prompt
from tailoring.format_gap_analysis import format_gap_analysis
from tailoring.labeled_sources import LabeledSources, label_sources

LIBRARY_FACT_OMITTED_WARNING = "One of your notes was left out."

@dataclass(frozen=True)
class SectionPrompt:
    """One section's prompt and the sources its labels name."""

    text: str
    sources: LabeledSources
    section_type: str


def build_section_prompt(
    section_type: str,
    context: GapAnalysisContext,
    gap_responses: list[GapResponseSnapshot | dict],
    selected_sections: list[dict[str, object]],
    retrieved: set[tuple[str, str]] | None,
    *,
    write_anyway: bool,
    gap_analysis: dict[str, object] | None,
    trusted_gap_analysis: bool = False,
    today: date | None = None,
    allow_text: Callable[[str], object] | None = None,
    warnings: list[str] | None = None,
    source_labels: set[str] | None = None,
) -> SectionPrompt:
    """Builds one prompt; retrieval narrows library evidence but retains supplied snapshots.
    The `selected_sections` argument contains generated/copied draft snapshots. Rejected
    optional sources are omitted; required job context fails closed."""
    sources = label_sources(context, gap_responses, selected_sections, retrieved, section_type)
    if source_labels is not None:
        sources.records = {label: record for label, record in sources.records.items()
                           if label in source_labels or record.kind == "selected_section"}
    if allow_text is not None:
        sources.records = {
            label: record for label, record in sources.records.items()
            if _allowed(record.text, allow_text, warnings)
        }
    today = today or datetime.now(UTC).date()
    expiry_statuses = [
        f"C{number}: {certification_expiry_status(item.expiry_date, item.expiry_date_precision, today)}"
        for number, item in enumerate(context.career_library.certifications, start=1)
        if f"C{number}" in sources.records
    ]
    job_text = job_context_text(context)
    if allow_text is not None and not getattr(allow_text(job_text), "allowed", False):
        raise ValueError("The job context could not be screened. Please try again.")
    analysis_text = format_gap_analysis(gap_analysis)
    if analysis_text and allow_text is not None and not trusted_gap_analysis and not _allowed(
        analysis_text, allow_text, warnings
    ):
        analysis_text = ""
    values = [job_text, *([analysis_text] if analysis_text else []), *[record.text for record in sources.records.values()]]
    labels = list(sources.records)
    has_analysis = bool(analysis_text)

    def render(approved_values: Sequence[str]) -> str:
        """Attach approved job, analysis, and sources to their roles before rendering."""
        offset = 2 if has_analysis else 1
        section = TailoringSectionInput(
            section_type=section_type, today=today, expiry_statuses=tuple(expiry_statuses),
            write_anyway=write_anyway, job_context=approved_values[0],
            analysis_text=approved_values[1] if has_analysis else None,
            sources=tuple(zip(labels, approved_values[offset:], strict=True)),
        )
        return format_tailoring_section_input(section)

    return SectionPrompt(
        text=bind_screened_prompt(values, render) if allow_text is not None else render(values),
        sources=sources,
        section_type=section_type,
    )


def job_context_text(context: GapAnalysisContext) -> str:
    """The exact job input shared by retrieval screening and generation."""
    return "\n".join([
        f"# Job: {context.job.title} at {context.job.company or 'Unknown company'}",
        *_bullets("Requirements", context.job.requirements),
        *_bullets("Nice to have", context.job.nice_to_haves),
    ])


def _allowed(text: str, allow_text: Callable[[str], object], warnings: list[str] | None) -> bool:
    """Omit unsafe optional evidence, keeping one warning per reason."""
    outcome = allow_text(text)
    if getattr(outcome, "allowed", False):
        return True
    if warnings is not None:
        import text_limits

        warning = text_limits.NOTE_TOO_LONG_WARNING if getattr(outcome, "too_long", False) else LIBRARY_FACT_OMITTED_WARNING
        if warning not in warnings:
            warnings.append(warning)
    return False


def _bullets(heading: str, items: list[str]) -> list[str]:
    """A heading and one bullet per item, or nothing when the list is empty."""
    if not items:
        return []
    return ["", f"## {heading}", *[f"- {item}" for item in items]]
