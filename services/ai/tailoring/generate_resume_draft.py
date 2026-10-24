"""Write, measure and independently review a complete Markdown resume before publishing.

The complete screened owner-scoped library remains available through up to three drafts.
This module only reads domain data; Rails saves the draft after the user reviews it.
"""

import asyncio
import json
from dataclasses import dataclass
from uuid import UUID

from agents.resume_document_agent import write_resume_document
from agents.resume_editorial_agent import review_resume_document
from agents.user_text_screen_agent import screen_user_message_async
from documents.resume_measure import ResumeRenderError, render_and_measure_resume_async
from screening.guardrail_usage import collect_guardrail_usage
from screening.library_fields import screen_library_fields_async
from screening.screen_user_text import screen_user_text_async
from screening.session import bind_screened_prompt, remaining_timeout, screening_session
from tailoring.library_narrative import MIN_TWO_PAGE_WORDS, narrative_word_count
from tailoring.tailor_resume_input import TailorResumeInput
from text_limits import MAX_PROMPT_TEXT, MAX_SCREENED_TEXT
from worker.model_prices import build_model_usage
from worker.queue_messages import ModelUsage
from worker.task_dependencies import TaskDependencies


class ResumeDraftInputError(ValueError):
    """An expected input problem whose message may be shown to the user."""


@dataclass
class ResumeDraft:
    markdown: str
    target_pages: int
    warnings: list[str]
    measurements: dict[str, int | float]
    editorial_review: dict[str, object]
    drafts: int


async def generate_resume_draft(
    user_id: UUID,
    data: TailorResumeInput,
    dependencies: TaskDependencies,
    *,
    usage: list[ModelUsage],
) -> ResumeDraft:
    """Publish only a rendered and editorially reviewed whole document, never partial work."""
    settings = dependencies.settings
    with screening_session(settings.llm_run_timeout_seconds, reuse=True):
        async with asyncio.timeout(remaining_timeout(settings.llm_run_timeout_seconds)):
            context = dependencies.read_gap_analysis_context(user_id, data.job_id)
            if context is None:
                raise ResumeDraftInputError("This job no longer exists.")
            library = context.career_library
            if library.is_empty() and not library.summary:
                raise ResumeDraftInputError(
                    "Add experience to your career library before writing a resume."
                )
            if data.target_pages == 2 and narrative_word_count(library) < MIN_TWO_PAGE_WORDS:
                raise ResumeDraftInputError(
                    "Your career library needs at least 700 words of substantive narrative for two pages. Choose one page or add more detail."
                )
            library_text = library.model_dump_json(exclude_none=True)
            if len(library_text) > MAX_SCREENED_TEXT:
                raise ResumeDraftInputError("Your career library is too long for resume writing.")

            async def classify(text):
                return await screen_user_text_async(
                    text,
                    settings.user_text_screen_model,
                    remaining_timeout(settings.llm_run_timeout_seconds),
                    check_phrases=True,
                    classify=screen_user_message_async,
                )

            values = [
                library_text,
                context.job.model_dump_json(exclude_none=True),
                json.dumps(data.contact),
                json.dumps(
                    {"gap_analysis": data.gap_analysis, "gap_responses": data.gap_responses}
                ),
            ]
            with collect_guardrail_usage(usage):
                decision = await screen_library_fields_async(
                    library, classify, approved_sources=[library_text]
                )
                if decision is not True and not getattr(decision, "allowed", False):
                    raise ResumeDraftInputError(
                        "The career library could not pass the input safety check."
                    )
                for value in values[1:]:
                    decision = await classify(value)
                    if not decision.allowed:
                        raise ResumeDraftInputError(
                            "The resume context could not pass the input safety check."
                        )
            source = bind_screened_prompt(
                values,
                lambda texts: "\n\n".join(
                    [
                        f"Requested pages: {data.target_pages}",
                        "Complete career library:",
                        texts[0],
                        "Job:",
                        texts[1],
                        "Contact:",
                        texts[2],
                        "Job comparison and user notes:",
                        texts[3],
                    ]
                ),
            )
            feedback = ""
            for attempt in range(1, 4):
                prompt = source + feedback
                if len(prompt) > MAX_PROMPT_TEXT:
                    raise ResumeDraftInputError(
                        "This resume context is too long. Shorten your career library or job."
                    )
                writing = await write_resume_document(prompt, settings)
                usage.append(build_model_usage(writing.model, writing.usage))
                draft = writing.output
                try:
                    measured = await render_and_measure_resume_async(
                        draft.markdown,
                        timeout_seconds=remaining_timeout(settings.llm_run_timeout_seconds),
                    )
                except ResumeRenderError as error:
                    raise ResumeDraftInputError(str(error)) from error
                measurements = {
                    "page_count": measured.page_count,
                    "final_page_occupied_share": measured.final_page_occupied_share,
                }
                review_prompt = (
                    source
                    + "\n\nDraft and measured layout:\n"
                    + json.dumps(
                        {
                            "markdown": draft.markdown,
                            "measurements": measurements,
                            "writer_sufficiency": draft.sufficiency_explanation,
                            "writer_sufficient_for_target": draft.sufficient_for_target,
                        }
                    )
                )
                if len(review_prompt) > MAX_PROMPT_TEXT:
                    raise ResumeDraftInputError(
                        "The resume and context are too long for editorial review."
                    )
                reviewing = await review_resume_document(review_prompt, settings)
                usage.append(build_model_usage(reviewing.model, reviewing.usage))
                review = reviewing.output
                within_pages = measured.page_count <= data.target_pages
                shorter = data.target_pages == 2 and measured.page_count < 2
                supported_shorter = (
                    shorter
                    and not review.sufficient_for_target
                    and bool(review.sufficiency_explanation.strip())
                )
                if within_pages and review.ready and (not shorter or supported_shorter):
                    break
                feedback = (
                    "\n\nRevise the entire draft from this previous draft, actual measurement and independent review:\n"
                    + json.dumps(
                        {
                            "previous_draft": draft.model_dump(),
                            "measurements": measurements,
                            "editorial_review": review.model_dump(),
                        }
                    )
                )
            if not within_pages:
                raise ResumeDraftInputError(
                    "The resume could not fit the selected page target after three drafts. Please try again."
                )
            if shorter and not supported_shorter:
                raise ResumeDraftInputError(
                    "The writer could not produce the requested length or a reviewed insufficiency explanation after three drafts. Please try again."
                )
            warnings = []
            if shorter:
                explanation = (
                    review.sufficiency_explanation.strip() or draft.sufficiency_explanation.strip()
                )
                if not explanation:
                    raise ResumeDraftInputError(
                        "The shorter resume did not include a sufficiency explanation. Please try again."
                    )
                warnings.append(explanation)
            if not review.ready:
                warnings.append("The editorial review recommends further edits: " + review.feedback)
            return ResumeDraft(
                draft.markdown,
                data.target_pages,
                warnings,
                measurements,
                review.model_dump(),
                attempt,
            )
