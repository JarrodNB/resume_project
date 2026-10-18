"""Prepare a user's shared evidence for a complete resume, without writing it.

Screen the job before retrieval, then the union of selected sources. Approvals live in
one enclosing execution; copied display-only fields do not require model screening.
"""

import asyncio
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from uuid import UUID

from agents.user_text_screen_agent import screen_user_message_async
from schemas.gap_analysis_context import GapAnalysisContext
from screening.screen_user_text import ScreenOutcome, screen_user_text_async
from screening.session import current_session, remaining_timeout, screening_session
from tailoring.build_section_prompt import SectionPrompt, build_section_prompt, job_context_text
from tailoring.labeled_sources import label_sources
from tailoring.retrieve_for_section import retrieve_source_keys_async
from worker.model_prices import build_model_usage
from worker.queue_messages import ModelUsage
from worker.settings import WorkerSettings
from worker.task_dependencies import TaskDependencies


class ResumePreparationError(ValueError):
    """Expected missing or rejected input, safe to show as a failed draft message."""


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
    _gap_responses: list[dict[str, str]] = field(repr=False)
    _gap_analysis: dict[str, object] | None = field(repr=False)
    _retrieved: dict[str, set[tuple[str, str]] | None] = field(repr=False)
    _decisions: dict[str, ScreenOutcome] = field(repr=False)
    _usage: list[ModelUsage] = field(repr=False)
    _warnings: list[str] = field(repr=False)
    _concurrency: int = field(repr=False)
    _session: object = field(default_factory=current_session, repr=False)

    async def _screen(self, texts: Sequence[str]) -> None:
        async def classify(text, model, timeout):
            run = await screen_user_message_async(text, model, timeout)
            # Record each actual chunk immediately, including chunks before cancellation.
            self._usage.append(build_model_usage(run.model_name, run.usage))
            return run

        async def check(text):
            if text not in self._decisions:
                self._decisions[text] = await screen_user_text_async(
                    text, self._settings.user_text_screen_model,
                    remaining_timeout(self._settings.llm_run_timeout_seconds),
                    check_phrases=True, classify=classify,
                )

        await _bounded(list(dict.fromkeys(texts)), check, self._concurrency)

    def _prompt(self, section_type, selected_sections, selected_labels=None):
        return build_section_prompt(
            section_type, self.context, self._gap_responses, selected_sections,
            None if section_type == "summary" and selected_labels is not None else self._retrieved[section_type],
            write_anyway=False, gap_analysis=self._gap_analysis,
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
        sources = label_sources(self.context, self._gap_responses, selected_sections,
            None if selected_labels is not None else self._retrieved["summary"], "summary")
        await self._screen([record.text for label, record in sources.records.items()
                            if selected_labels is None or label in selected_labels or record.kind == "selected_section"])
        return self._prompt("summary", selected_sections, selected_labels)


async def prepare_resume_draft(
    user_id: UUID, job_id: UUID, dependencies: TaskDependencies, *,
    usage: list[ModelUsage], warnings: list[str],
    gap_responses: list[dict[str, str]] | None = None,
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
            prepared = PreparedResumeDraft(context, {}, settings, gap_responses or [],
                gap_analysis, {}, {}, usage, warnings, concurrency)
            job_text = job_context_text(context)
            await prepared._screen([job_text])
            if not prepared._decisions[job_text].allowed:
                raise ResumePreparationError("The job context could not be screened. Please try again.")
            sections = ["summary"]
            for section, rows in (("experience", context.career_library.experiences),
                                  ("projects", context.career_library.projects),
                                  ("skills", context.career_library.skills)):
                if rows:
                    sections.append(section)
            # Native projects/skills are all available; only mixed evidence needs retrieval.
            async def retrieve(section):
                if section in {"projects", "skills"}:
                    prepared._retrieved[section] = set()
                else:
                    keys, embedding_usage = await retrieve_source_keys_async(user_id, section, context.job, settings)
                    prepared._retrieved[section] = keys
                    if embedding_usage is not None:
                        usage.append(embedding_usage)
            await _bounded(sections, retrieve, concurrency)
            texts = [job_text]
            summary = (gap_analysis or {}).get("summary")
            if isinstance(summary, str) and summary.strip():
                texts.append(summary.strip())
            for section in sections:
                sources = label_sources(context, prepared._gap_responses, [], prepared._retrieved[section], section)
                texts.extend(record.text for record in sources.records.values())
            await prepared._screen(texts)
            prepared.prompts = {section: prepared._prompt(section, []) for section in sections}
            return prepared
