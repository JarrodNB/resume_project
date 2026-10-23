"""Import one screened resume through a separate typed extraction implementation.

The caller supplies masked text under its task privacy scope and restores the returned
public result. This module owns screening, the whole deadline, extraction and source assembly.
"""

import asyncio
import re
from typing import NamedTuple

from opentelemetry import trace
from pydantic_ai.settings import ModelSettings, ThinkingLevel
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputBlocked

from agents.resume_import_agent import resume_import_agent
from prompts.resume_import_instructions import RESUME_IMPORT_PROMPT_VERSION
from resume_import.budget import ImportBudgetModel
from resume_import.chunks import structural_chunks
from resume_import.source import ResumeSource
from schemas.parsed_resume import ParsedResume
from schemas.resume_import import ResumeImportExtraction
from screening import prompt_guardrail
from screening.prompt_guardrail import BLOCKED_MESSAGE, UNCHECKED_MESSAGE
from screening.screen_user_text import screen_user_text_async
from screening.session import bind_screened_prompt, remaining_timeout, within_screening_session
from worker.generative_model import generative_model
from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import ModelUsage
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.tracing import record_prompt_version

_tracer = trace.get_tracer(__name__)
_FENCE = re.compile(r"<\s*/?\s*resume\s*>", re.IGNORECASE)


class ResumeImportRun(NamedTuple):
    """Complete public result plus extraction usage; concrete task accounting owns failures."""

    parsed_resume: ParsedResume
    usage: RunUsage
    model: str
    model_usages: list[ModelUsage]


@within_screening_session
def import_resume_text(
    resume_text: str,
    model: str,
    thinking: ThinkingLevel,
    timeout_seconds: float,
    fallback_model: str,
) -> ResumeImportRun:
    """Extract one complete masked document atomically, failing closed on screening/errors.

    Caller must keep import_privacy_scope active around this call and restore the output.
    Screening and generation share the enclosing task deadline. The result includes screen
    charges; TaskUsage remains authoritative for concrete fallback and failed requests.
    """
    return asyncio.run(_import(resume_text, model, thinking, timeout_seconds, fallback_model))


async def _import(text, model, thinking, timeout_seconds, fallback_model):
    settings = load_settings()
    source = ResumeSource(text)
    chunks = structural_chunks(text, source)
    semaphore = asyncio.Semaphore(3)
    budget = ImportBudgetModel(
        generative_model(model, fallback_model), agent_usage_limits(settings)
    )

    async def extract(chunk_text, owned, start):
        async with semaphore:
            return await _extract_chunk(
                chunk_text, owned, start, source, budget, model, thinking, timeout_seconds, settings
            )

    async with asyncio.timeout(remaining_timeout(timeout_seconds)):
        tasks = [
            asyncio.create_task(extract(chunk, owned, start)) for chunk, owned, start in chunks
        ]
        try:
            results = await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            raise
        outputs = [result[0] for result in results]
        combined = ResumeImportExtraction(
            records=[record for output in outputs for record in output.records],
            unassigned_highlights=[
                item for output in outputs for item in output.unassigned_highlights
            ],
            parsing_warnings=[warning for output in outputs for warning in output.parsing_warnings],
        )
        parsed = source.reconstruct(combined)
        usage = RunUsage()
        usages = []
        for _, result, screen in results:
            usage.incr(result.usage)
            answering_model = reported_model_name(result.response.model_name or model, model)
            usages.extend([build_model_usage(answering_model, result.usage), *screen.model_usages])
        return ResumeImportRun(parsed, usage, answering_model, usages)


async def _extract_chunk(
    text, owned, start, source, budget, model, thinking, timeout_seconds, settings
):
    screen = await screen_user_text_async(
        text,
        settings.user_text_screen_model,
        remaining_timeout(timeout_seconds),
        check_phrases=False,
        max_characters=len(text),
        classify=prompt_guardrail._screen_prompt_text,
    )
    if not screen.allowed:
        raise InputBlocked(UNCHECKED_MESSAGE if screen.unchecked else BLOCKED_MESSAGE)
    chunk_source = source.subset(owned)

    def render(sources):
        # Global IDs are trusted scaffolding; all displayed source text is taken
        # from the approved string, not from a captured source registry.
        lines = sources[0].split("\n")
        for key in owned:
            passage = source.passages[key]
            local = passage.start_line - start
            if 0 <= local < len(lines):
                lines[local] = f"[{key}] " + lines[local]
        labeled = "\n".join(lines)
        return (
            "<resume>\n"
            + _FENCE.sub(lambda match: match.group().replace("<", "&lt;"), labeled)
            + "\n</resume>"
        )

    prompt = bind_screened_prompt([text], render)
    with (
        record_prompt_version(RESUME_IMPORT_PROMPT_VERSION),
        _tracer.start_as_current_span(
            "resume_import.extract_chunk", record_exception=False, set_status_on_exception=False
        ) as span,
    ):
        result = await resume_import_agent.run(
            prompt,
            output_type=chunk_source.output_type,
            model=budget,
            model_settings=ModelSettings(thinking=thinking),
            usage_limits=agent_usage_limits(settings),
        )
        span.set_attribute("resume_import.requests", result.usage.requests)
        span.set_attribute("resume_import.input_tokens", result.usage.input_tokens)
        span.set_attribute("resume_import.output_tokens", result.usage.output_tokens)
    return result.output, result, screen
