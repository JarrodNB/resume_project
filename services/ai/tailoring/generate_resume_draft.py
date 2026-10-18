"""Build one complete resume draft from shared, screened evidence.

Independent writers overlap, then the summary uses the selected content. All children
stop before a failure escapes. This module only reads; saving remains a Rails action.
"""

import asyncio
from dataclasses import dataclass
from uuid import UUID

import text_limits
from agents.resume_tailoring_agent import write_resume_section_async
from screening.saved_sources import register_saved_sources
from screening.session import remaining_timeout, screening_session
from tailoring.labeled_sources import label_sources
from tailoring.materialize_section import copy_library_section, materialize_section
from tailoring.prepare_resume_draft import ResumePreparationError, prepare_resume_draft
from tailoring.section_catalog import SECTION_ORDER, SECTION_TITLES
from tailoring.tailor_resume_input import TailorResumeInput
from worker.model_prices import build_model_usage
from worker.queue_messages import ModelUsage
from worker.task_dependencies import TaskDependencies


class ResumeDraftInputError(ValueError):
    """An expected input problem whose message may be shown to the user."""


@dataclass
class ResumeDraft:
    sections: list[dict[str, object]]
    warnings: list[str]


async def generate_resume_draft(
    user_id: UUID, data: TailorResumeInput, dependencies: TaskDependencies, *, usage: list[ModelUsage],
) -> ResumeDraft:
    """Prepare once and return an ordered complete draft, or raise without partial results."""
    settings = dependencies.settings
    warnings: list[str] = []
    with screening_session(settings.llm_run_timeout_seconds, reuse=True):
        if data.saved_input_snapshot == "resume_tailoring_v1":
            register_saved_sources([
                f"{response.get('requirement', '')}: {response.get('body', '')}"
                for response in data.gap_responses
            ])
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            try:
                prepared = await prepare_resume_draft(user_id, data.job_id, dependencies,
                    usage=usage, warnings=warnings, gap_responses=data.gap_responses, gap_analysis=data.gap_analysis)
            except ResumePreparationError as error:
                raise ResumeDraftInputError(str(error)) from error

            async def write(prompt):
                if text_limits.prompt_is_too_long(prompt.text):
                    raise ResumeDraftInputError(text_limits.TAILOR_PROMPT_TOO_LONG_MESSAGE)
                run = await write_resume_section_async(prompt, settings.resume_tailoring_model,
                    settings.resume_tailoring_thinking, remaining_timeout(settings.llm_run_timeout_seconds),
                    settings.generative_fallback_model)
                usage.append(build_model_usage(run.model or settings.resume_tailoring_model, run.usage))
                return run.draft

            # There are at most three independent writers; no unbounded provider fanout.
            tasks = {}
            for section, kind in (("experience", "experience"), ("projects", "project"), ("skills", "skill")):
                prompt = prepared.prompts.get(section)
                if prompt is None:
                    continue
                if not any(record.kind == kind for record in prompt.sources.records.values()):
                    warnings.append(f"{SECTION_TITLES[section]} was omitted because no usable evidence remained after screening.")
                    continue
                tasks[section] = asyncio.create_task(write(prompt))
            try:
                await asyncio.gather(*tasks.values())
            finally:
                for child in tasks.values():
                    if not child.done():
                        child.cancel()
                await asyncio.gather(*tasks.values(), return_exceptions=True)

            sections = {"contact": {"full_name": data.contact.get("full_name"),
                "email": data.contact.get("email"), "phone": data.contact.get("phone"),
                "location": data.contact.get("location"), "links": list(data.contact.get("links") or [])}}
            selected_labels: set[str] = set()
            library = prepared.context.career_library
            for section, child in tasks.items():
                draft = child.result()
                if draft.nothing_fits:
                    warnings.append(f"{SECTION_TITLES[section]} was omitted because no relevant evidence fit this job.")
                    continue
                selected_labels.update(entry.label for entry in draft.entries)
                selected_labels.update(label for entry in draft.entries for prose in entry.prose for label in prose.source_labels)
                sections[section] = materialize_section(section, draft, library, prepared.prompts[section].sources)
            sources = label_sources(prepared.context, [], [], None)
            for section, kind in (("education", "education"), ("certifications", "certification")):
                labels = [label for label, record in sources.records.items() if record.kind == kind]
                if labels:
                    selected_labels.update(labels)
                    sections[section] = copy_library_section(section, library, sources)
            if not selected_labels:
                selected_labels.update(label for label, record in prepared.prompts["summary"].sources.records.items()
                    if record.kind in {"summary", "fact", "gap_response"})
            snapshots = [{"section_type": section, "title": SECTION_TITLES[section], "content": sections[section]}
                for section in SECTION_ORDER if section in sections and section != "contact"]
            summary = await prepared.summary_prompt(snapshots, selected_labels=selected_labels)
            if summary.sources.records:
                draft = await write(summary)
                if draft.nothing_fits:
                    warnings.append("Summary was omitted because no relevant evidence fit this job.")
                else:
                    sections["summary"] = materialize_section("summary", draft, library, summary.sources)
            elif selected_labels or snapshots:
                warnings.append("Summary was omitted because no usable evidence remained after screening.")
            return ResumeDraft([{"section_type": section, "title": SECTION_TITLES[section], "content": sections[section]}
                for section in SECTION_ORDER if section in sections], warnings)
