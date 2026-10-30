"""Prepare a user's shared evidence for a complete resume, without writing it.

Screen the job and the union of section sources in one saved-record batch. Saved job and library fields reuse
their checks without losing record identities when rendered text is shared.
Temporary inputs stay within one enclosing execution.
"""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass, field, replace
from uuid import UUID

import text_limits
from agents.user_text_screen_agent import screen_user_message_async
from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext
from schemas.gap_response import GapResponseSnapshot
from schemas.model_usage import ModelUsage
from screening.guardrail_usage import collect_guardrail_usage
from screening.record_adapters import gap_response_records, job_records, library_records
from screening.records import record_failure_message, screen_records
from screening.screen_user_text import ScreenOutcome, screen_user_text_async
from screening.session import (
    current_session,
    remaining_timeout,
    screening_session,
    trust_generated_source,
)
from settings import AISettings
from tailoring.build_section_prompt import SectionPrompt, build_section_prompt, job_context_text
from tailoring.format_gap_analysis import format_gap_analysis
from tailoring.labeled_sources import SourceRecord, label_sources
from text_limits import MAX_SCREENED_TEXT
from worker.task_dependencies import TaskDependencies


class ResumePreparationError(ValueError):
    """Expected missing or rejected input, safe to show as a failed draft message."""


def _library_text_length(library: CareerLibrary) -> int:
    """Count each saved text field tailoring reads once, without labels or metadata."""
    total = len(library.summary or "")
    for rows, names in (
        (library.experiences, ("company", "title", "location", "description")),
        (library.projects, ("name", "role", "description")),
        (library.educations, ("institution", "degree", "field_of_study", "description")),
        (library.certifications, ("name", "issuer", "credential_id", "credential_url", "description")),
        (library.skills, ("name", "category")),
        (library.career_contexts, ("requirement", "response")),
    ):
        total += sum(len(getattr(row, name) or "") for row in rows for name in names)
    total += sum(len(highlight.content) for experience in library.experiences
                 for highlight in experience.highlights)
    return total


@dataclass
class PreparedResumeDraft:
    """Screened section prompts and the source context needed to copy identity fields.

    Use inside the same screening session as preparation and generation. `summary_prompt`
    reuses generated section snapshots without screening AI output again.
    """

    context: GapAnalysisContext
    prompts: dict[str, SectionPrompt]
    _settings: AISettings = field(repr=False)
    _gap_responses: list[GapResponseSnapshot | dict] = field(repr=False)
    _gap_analysis: dict[str, object] | None = field(repr=False)
    _decisions: dict[str, ScreenOutcome] = field(repr=False)
    _usage: list[ModelUsage] = field(repr=False)
    _warnings: list[str] = field(repr=False)
    _concurrency: int = field(repr=False)
    _session: object = field(default_factory=current_session, repr=False)

    async def _screen(self, records: Sequence[SourceRecord], *, include_job: bool = False) -> None:
        """Check every saved identity together, even when several sources render equally."""
        saved = []
        for source in records:
            if source.provenance:
                provenance = source.provenance
                saved.extend(library_records(provenance.library, used_fields=provenance.used_fields))
            elif source.gap_response is not None:
                saved.extend(gap_response_records([source.gap_response]))
            elif source.kind == "selected_section":
                # These snapshots come from the current draft writers, not browser edits.
                trust_generated_source(source.text)
                self._decisions[source.text] = ScreenOutcome(True)
            else:
                raise ValueError("Tailoring evidence needs saved-record or generated provenance")
        if include_job:
            saved.extend(job_records(self.context.job))
        # A role also supplies the title/company attached to each highlight. Merge those
        # overlapping projections before screening, retaining only used fields.
        merged = {}
        for record in saved:
            key = (record.record_type, record.record_id) if record.record_id else (
                record.record_type, None, tuple((name, str(value)) for name, value in record.fields.items()))
            previous = merged.get(key)
            if previous:
                for name in previous.fields.keys() & record.fields.keys():
                    if previous.fields[name] != record.fields[name]:
                        raise ValueError("Conflicting tailoring snapshots for one saved record")
                record = replace(previous, fields={**previous.fields, **record.fields},
                                 approved_fields=previous.approved_fields | record.approved_fields)
            merged[key] = record
        texts = [source.text for source in records if source.kind != "selected_section"]
        if include_job:
            texts.append(job_context_text(self.context))

        async def classify(text):
            return await screen_user_text_async(text, self._settings.user_text_screen_model,
                remaining_timeout(self._settings.llm_run_timeout_seconds), check_phrases=False,
                classify=screen_user_message_async)

        with collect_guardrail_usage(self._usage):
            outcome = await screen_records(list(merged.values()), approved_sources=texts, screen=classify)
        for text in texts:
            self._decisions[text] = outcome.decision
        if include_job and not outcome.allowed:
            # The required job shares this batch: a failed blob rejects the entire call.
            raise ResumePreparationError(record_failure_message(outcome))

    def _prompt(self, section_type, selected_sections, selected_labels=None):
        return build_section_prompt(
            section_type, self.context, self._gap_responses, selected_sections,
            write_anyway=False, gap_analysis=self._gap_analysis,
            trusted_gap_analysis=True,
            allow_text=lambda text: self._decisions[text], warnings=self._warnings,
            source_labels=selected_labels,
        )

    async def summary_prompt(
        self, selected_sections: list[dict[str, object]], *, selected_labels: set[str] | None = None,
    ) -> SectionPrompt:
        """Screen selected snapshots; optionally retain only original labels used by writers.

        Labels keep their original numbering. Reusing this object in a later execution
        is rejected: callers must prepare again rather than carry approvals forward.
        """
        if current_session() is not self._session:
            raise RuntimeError("Prepare evidence again inside the current screening session")
        sources = label_sources(self.context, self._gap_responses, selected_sections)
        records = [record for label, record in sources.records.items()
                   if selected_labels is None or label in selected_labels or record.kind == "selected_section"]
        await self._screen(records)
        return self._prompt("summary", selected_sections, selected_labels)


async def prepare_resume_draft(
    user_id: UUID, job_id: UUID, dependencies: TaskDependencies, *,
    usage: list[ModelUsage], warnings: list[str],
    gap_responses: list[GapResponseSnapshot | dict] | None = None,
    gap_analysis: dict[str, object] | None = None, concurrency: int = 3,
) -> PreparedResumeDraft:
    """Read once and prepare per-section evidence with bounded provider overlap.

    The caller owns the enclosing `screening_session` through generation. Standalone
    preparation still isolates its checks, but its prompt coverage expires on return.
    Required job failure raises ResumePreparationError; optional source failures become warnings.
    """
    if concurrency < 1:
        raise ValueError("Concurrency must be at least one")
    settings = dependencies.settings
    with screening_session(settings.llm_run_timeout_seconds, reuse=True):
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            context = dependencies.read_gap_analysis_context(user_id, job_id)
            if context is None:
                raise ResumePreparationError("This job no longer exists.")
            if _library_text_length(context.career_library) > text_limits.MAX_SCREENED_TEXT:
                raise ResumePreparationError(text_limits.TAILOR_LIBRARY_TOO_LONG_MESSAGE)
            prepared = PreparedResumeDraft(context, {}, settings, gap_responses or [],
                gap_analysis, {}, usage, warnings, concurrency)
            # Rails snapshots this from the latest completed gap-analysis task. That
            # worker already screened its job and library inputs before writing it.
            trust_generated_source(format_gap_analysis(gap_analysis))
            job_text = job_context_text(context)
            if len(job_text) > MAX_SCREENED_TEXT:
                raise ResumePreparationError("The job context could not be screened. Please try again.")

            sections = ["summary"]
            for section, rows in (("experience", context.career_library.experiences),
                                  ("projects", context.career_library.projects),
                                  ("skills", context.career_library.skills)):
                if rows:
                    sections.append(section)
            sources = label_sources(context, prepared._gap_responses, [])
            await prepared._screen(list(sources.records.values()), include_job=True)
            prepared.prompts = {section: prepared._prompt(section, []) for section in sections}
            return prepared
