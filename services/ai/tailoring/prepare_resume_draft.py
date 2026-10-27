"""Prepare a user's shared evidence for a complete resume, without writing it.

Screen the job, then the union of section sources. Saved job and library fields reuse
their checks without losing record identities when rendered text is shared.
Temporary inputs stay within one enclosing execution.
"""

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from uuid import UUID

import text_limits
from agents.user_text_screen_agent import screen_user_message_async
from schemas.gap_analysis_context import CareerLibrary, GapAnalysisContext
from schemas.gap_response import GapResponseSnapshot
from screening.gap_response_fields import screen_gap_response_fields
from screening.guardrail_usage import collect_guardrail_usage
from screening.job_fields import screen_job_fields_async
from screening.library_fields import screen_library_fields_async
from screening.screen_user_text import ScreenOutcome, screen_user_text_async
from screening.session import (
    current_session,
    remaining_timeout,
    screening_session,
    trust_generated_source,
)
from tailoring.build_section_prompt import SectionPrompt, build_section_prompt, job_context_text
from tailoring.format_gap_analysis import format_gap_analysis
from tailoring.labeled_sources import SourceRecord, label_sources
from text_limits import MAX_SCREENED_TEXT
from worker.queue_messages import ModelUsage
from worker.settings import WorkerSettings
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
        (library.facts, ("requirement", "response")),
    ):
        total += sum(len(getattr(row, name) or "") for row in rows for name in names)
    total += sum(len(highlight.content) for experience in library.experiences
                 for highlight in experience.highlights)
    return total


async def _bounded[T](items: Sequence[T], operation: Callable[[T], Awaitable[None]], limit: int) -> None:
    """Wait for all children, including their cleanup when any child fails."""
    semaphore = asyncio.Semaphore(limit)

    async def one(item):
        async with semaphore:
            await operation(item)

    tasks = [asyncio.create_task(one(item)) for item in items]
    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


@dataclass
class PreparedResumeDraft:
    """Screened section prompts and the source context needed to copy identity fields.

    Use inside the same screening session as preparation and generation. `summary_prompt`
    screens newly written section snapshots before using them as additional evidence.
    """

    context: GapAnalysisContext
    prompts: dict[str, SectionPrompt]
    _settings: WorkerSettings = field(repr=False)
    _gap_responses: list[GapResponseSnapshot | dict] = field(repr=False)
    _gap_analysis: dict[str, object] | None = field(repr=False)
    _decisions: dict[str, ScreenOutcome] = field(repr=False)
    _usage: list[ModelUsage] = field(repr=False)
    _warnings: list[str] = field(repr=False)
    _concurrency: int = field(repr=False)
    _session: object = field(default_factory=current_session, repr=False)

    async def _screen(self, texts: Sequence[str], records: Sequence[SourceRecord] = ()) -> None:
        sources_by_text: dict[str, list[SourceRecord]] = {}
        for source in records:
            sources_by_text.setdefault(source.text, []).append(source)

        async def classify(text, *, max_characters=MAX_SCREENED_TEXT):
            return await screen_user_text_async(
                text, self._settings.user_text_screen_model,
                remaining_timeout(self._settings.llm_run_timeout_seconds),
                check_phrases=True, classify=screen_user_message_async,
                max_characters=max_characters,
            )

        async def check(text):
            saved = [source for source in sources_by_text.get(text, []) if source.provenance]
            if saved:
                # Rendered equality does not prove that every saved field was checked.
                # Visit all provenance even for cached text; field screening reuses
                # exact payload decisions while recording each covered row's identity.
                for source in saved:
                    provenance = source.provenance
                    # The saved plain text passed the aggregate cap before preparation.
                    # Field names and JSON escaping may make its screening envelope longer.
                    async def classify_library(payload):
                        return await classify(payload, max_characters=max(MAX_SCREENED_TEXT, len(payload)))

                    outcome = await screen_library_fields_async(
                        provenance.library, classify_library,
                        used_fields=provenance.used_fields, approved_sources=[text])
                    if outcome is True:
                        outcome = ScreenOutcome(True)
                    if text not in self._decisions or self._decisions[text].allowed:
                        self._decisions[text] = outcome
            elif text not in self._decisions:
                self._decisions[text] = (ScreenOutcome(False, too_long=True)
                                         if len(text) > MAX_SCREENED_TEXT else await classify(text))

        # Shared screening records both classifiers immediately, including completed
        # chunks before a later block or cancellation. Cached decisions add no charge.
        with collect_guardrail_usage(self._usage):
            unique = list(dict.fromkeys(texts))
            gap_sources = [(source.gap_response, source.text) for source in records
                           if source.gap_response is not None]
            gap_outcomes = await screen_gap_response_fields(gap_sources, classify)
            for text, outcome in gap_outcomes.items():
                if text not in self._decisions or self._decisions[text].allowed:
                    self._decisions[text] = outcome
            # Highlights also contain their role's identity. Finish role checks first
            # so highlights reuse those fields rather than paying to check them twice.
            highlights = [text for text in unique
                          if any(source.kind == "highlight" for source in sources_by_text.get(text, []))]
            await _bounded([text for text in unique if text not in highlights],
                           check, self._concurrency)
            await _bounded(highlights, check, self._concurrency)

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
        await self._screen([record.text for record in records], records)
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

            async def classify_job(text):
                return await screen_user_text_async(text, settings.user_text_screen_model,
                    remaining_timeout(settings.llm_run_timeout_seconds), check_phrases=True,
                    classify=screen_user_message_async)

            with collect_guardrail_usage(usage):
                outcome = await screen_job_fields_async(context.job, classify_job, approved_sources=[job_text])
            prepared._decisions[job_text] = ScreenOutcome(True) if outcome is True else outcome
            if not prepared._decisions[job_text].allowed:
                raise ResumePreparationError("The job context could not be screened. Please try again.")
            sections = ["summary"]
            for section, rows in (("experience", context.career_library.experiences),
                                  ("projects", context.career_library.projects),
                                  ("skills", context.career_library.skills)):
                if rows:
                    sections.append(section)
            texts = [job_text]
            records = []
            for section in sections:
                sources = label_sources(context, prepared._gap_responses, [])
                texts.extend(record.text for record in sources.records.values())
                records.extend(sources.records.values())
            await prepared._screen(texts, records)
            prepared.prompts = {section: prepared._prompt(section, []) for section in sections}
            return prepared
