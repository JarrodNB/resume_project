"""Reuse saved checks for career-library fields without putting metadata in prompts.

Callers choose a library snapshot containing only the entries and fields they use.
Unchecked text is screened together as labeled plain text; a rejected batch
grants no new approvals.
Rails saves successful field names from the execution's final result.
"""

from collections.abc import Awaitable, Callable, Mapping, Sequence
from collections.abc import Set as AbstractSet
from typing import Any

from schemas.gap_analysis_context import CareerLibrary
from screening.session import current_session
from worker.contact_mask import mask_outbound
from worker.queue_messages import LibraryScreening

_RECORD_TYPES = {"experiences": "experience", "projects": "project", "educations": "education",
                 "certifications": "certification", "skills": "skill", "facts": "library_fact"}


def screen_library_fields(
    library: CareerLibrary, allow_text: Callable[[str], Any], *,
    include_fact_requirements: bool = True, used_fields: Mapping[str, AbstractSet[str]] | None = None,
    approved_sources: Sequence[str] = (),
) -> Any:
    """Screen unchecked used text, returning the caller's decision (or True on reuse).

    Limits on the complete source remain the caller's responsibility, including when
    every field is already checked. Optional consumers call this once per entry.
    used_fields maps singular record types to the fields the builder actually uses.
    approved_sources must contain only values from those fields and trusted formatting;
    callers must never pass additional user text or hidden record fields there.
    """
    pending, reports = _unchecked_fields(library, include_fact_requirements, used_fields)
    decision = allow_text(_screening_text(pending)) if pending else True
    return _finish(library, decision, reports, approved_sources, used_fields, include_fact_requirements)


async def screen_library_fields_async(
    library: CareerLibrary, allow_text: Callable[[str], Awaitable[Any]], *,
    include_fact_requirements: bool = True, used_fields: Mapping[str, AbstractSet[str]] | None = None,
    approved_sources: Sequence[str] = (),
) -> Any:
    """Apply the same saved-field checks without blocking asynchronous consumers."""
    pending, reports = _unchecked_fields(library, include_fact_requirements, used_fields)
    decision = await allow_text(_screening_text(pending)) if pending else True
    return _finish(library, decision, reports, approved_sources, used_fields, include_fact_requirements)


def _unchecked_fields(library, include_fact_requirements, used_fields):
    pending = []
    reports = []

    def collect(record_type, record_id, values, checked):
        checked = set(checked)
        if (session := current_session()) is not None:
            for report in session.library_screening:
                if report.record_type == record_type and report.record_id == record_id:
                    checked.update(report.fields)
        unchecked = {key: value for key, value in values.items()
                     if isinstance(value, str) and value.strip() and key not in checked
                     and not key.endswith("_precision")
                     and (used_fields is None or key in used_fields.get(record_type, set()))}
        if unchecked:
            pending.append(unchecked)
            if record_id:
                reports.append(LibraryScreening(record_type=record_type, record_id=record_id,
                                                fields=list(unchecked)))

    collect("user", library.summary_record_id, {"summary": library.summary}, library.screened_fields)
    for name, record_type in _RECORD_TYPES.items():
        for record in getattr(library, name):
            values = record.model_dump(exclude={"id", "highlights"})
            if name == "facts" and not include_fact_requirements:
                values.pop("requirement", None)
            collect(record_type, record.id, values, record.screened_fields)
            for highlight in getattr(record, "highlights", []):
                collect("experience_highlight", highlight.id, {"content": highlight.content},
                        highlight.screened_fields)
    return pending, reports


def _screening_text(pending: list[dict[str, str]]) -> str:
    """Label each unchecked field while preserving its text and entry boundaries."""
    return "\n\n---\n\n".join(
        f"Entry {entry_number}\n" + "\n\n".join(
            f"{field}:\n{value}" for field, value in fields.items()
        )
        for entry_number, fields in enumerate(pending, 1)
    )


def _finish(library, decision, reports, approved_sources, used_fields, include_fact_requirements):
    allowed = decision if isinstance(decision, bool) else getattr(decision, "allowed", False)
    if allowed and (session := current_session()) is not None:
        session.library_screening.extend(reports)
        sources = approved_sources
        if not sources and used_fields is None and include_fact_requirements:
            sources = (library.model_dump_json(exclude_none=True),)
        session.allowed_sources.update(mask_outbound(source) for source in sources)
    return decision
