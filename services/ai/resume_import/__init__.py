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
from resume_import.source import ResumeSource
from schemas.parsed_resume import ParsedResume
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
    async with asyncio.timeout(remaining_timeout(timeout_seconds)):
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
        source = ResumeSource(text)

        def render(sources):
            labeled = ResumeSource(sources[0]).annotated_text
            return (
                "<resume>\n"
                + _FENCE.sub(lambda match: match.group().replace("<", "&lt;"), labeled)
                + "\n</resume>"
            )

        prompt = bind_screened_prompt([text], render)
        with (
            record_prompt_version(RESUME_IMPORT_PROMPT_VERSION),
            _tracer.start_as_current_span(
                "resume_import.extract_chunk",
                record_exception=False,
                set_status_on_exception=False,
            ) as span,
        ):
            result = await resume_import_agent.run(
                prompt,
                output_type=source.output_type,
                model=generative_model(model, fallback_model),
                model_settings=ModelSettings(thinking=thinking),
                usage_limits=agent_usage_limits(settings),
            )
            span.set_attribute("resume_import.requests", result.usage.requests)
            span.set_attribute("resume_import.input_tokens", result.usage.input_tokens)
            span.set_attribute("resume_import.output_tokens", result.usage.output_tokens)
        parsed = source.reconstruct(result.output)
        answering_model = reported_model_name(result.response.model_name or model, model)
        return ResumeImportRun(
            parsed,
            result.usage,
            answering_model,
            [build_model_usage(answering_model, result.usage), *screen.model_usages],
        )
