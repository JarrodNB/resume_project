"""Extract three complete resume sections concurrently from one screened source.

The public interface returns one ParsedResume only after all groups succeed. The parser
owns group assembly, one deadline and combined budgets, and awaits cancelled siblings.
The documents module owns experience passage IDs and exact highlight reconstruction.
Optional inferred search titles travel beside the extracted facts, never inside ParsedResume.
"""

import asyncio
import re
from typing import NamedTuple

from opentelemetry import trace
from pydantic_ai import Agent
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.settings import ModelSettings, ThinkingLevel
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputBlocked, InputGuardrail

from conversation_logging import ConversationLogging
from documents.experience_source import ExperienceSource
from llm.generative_model import generative_model
from llm.model_prices import build_model_usage, reported_model_name
from llm.run_limits import agent_usage_limits
from prompts.resume_parsing_instructions import (
    RESUME_PARSING_INSTRUCTIONS,
    RESUME_PARSING_PROMPT_VERSION,
    format_resume_group_instruction,
)
from schemas.model_usage import ModelUsage
from schemas.parsed_resume import (
    ExperienceExtraction,
    ParsedResume,
    ProfileExtraction,
    ProjectsSkillsExtraction,
)
from screening import prompt_guardrail
from screening.prompt_guardrail import BLOCKED_MESSAGE, UNCHECKED_MESSAGE, screen_prompt
from screening.screen_user_text import screen_user_text_async
from screening.session import bind_screened_prompt, remaining_timeout, within_screening_session
from settings import load_settings
from telemetry.tracing import record_prompt_version

# A resume can contain the fence tags, including a space or newline inside the tag.
# Replacing "<" keeps the words and stops the tag closing.
_RESUME_TAG = re.compile(r"<\s*/?\s*resume\s*>", re.IGNORECASE)

def format_resume_user_prompt(resume_text: str) -> str:
    """Wraps extracted resume text as data. A tag inside the file cannot close the fence."""
    neutralized = _RESUME_TAG.sub(lambda match: match.group(0).replace("<", "&lt;"), resume_text)
    return f"<resume>\n{neutralized}\n</resume>"


_GROUPS = (ExperienceExtraction, ProjectsSkillsExtraction, ProfileExtraction)
_GROUP_NAMES = {
    ExperienceExtraction: "experience",
    ProjectsSkillsExtraction: "projects_skills",
    ProfileExtraction: "profile",
}
_group_tracer = trace.get_tracer(__name__)


class ParsingBudget(AbstractCapability):
    """Reserve concurrent requests before awaiting, then check combined returned tokens."""

    def __init__(self, limits):
        self.limits = limits
        self.usage = RunUsage()

    async def wrap_model_request(self, ctx, *, request_context, handler):
        self.limits.check_before_request(self.usage)
        self.usage.requests += 1
        response = await handler(request_context)
        self.usage.incr(response.usage)
        self.limits.check_tokens(self.usage)
        return response


resume_parsing_agent = Agent(
    name="resume_parsing_agent",
    output_type=ParsedResume,
    instructions=RESUME_PARSING_INSTRUCTIONS,
    retries=2,
    defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=screen_prompt)],
)




class ResumeParsingRun(NamedTuple):
    """The agent's output, the tokens it used, and the model name to bill."""

    parsed_resume: ParsedResume
    usage: RunUsage
    model: str = ""
    model_usages: list[ModelUsage] | None = None
    job_title_suggestions: list[str] | None = None


@within_screening_session
def parse_resume_text(
    resume_text: str,
    model: str,
    thinking: ThinkingLevel,
    timeout_seconds: float,
    fallback_model: str,
) -> ResumeParsingRun:
    """Extracts structured resume data from plain text using the given model name and reasoning
    effort. Raises TimeoutError if the whole run (including the provider's own retries) takes
    longer than timeout_seconds. Raises UsageLimitExceeded when the run passes its request,
    tool-call, or token cap. A provider error tries fallback_model."""
    return asyncio.run(
        _run_with_deadline(resume_text, model, thinking, timeout_seconds, fallback_model)
    )


async def _run_with_deadline(
    resume_text: str,
    model: str,
    thinking: ThinkingLevel,
    timeout_seconds: float,
    fallback_model: str,
) -> ResumeParsingRun:
    """Return all three groups in source order, cancelling and awaiting siblings on failure."""
    budget = ParsingBudget(agent_usage_limits(load_settings()))

    async def extract(schema):
        instruction = format_resume_group_instruction(schema.__name__)
        experience_source = None

        def build_prompt(sources):
            nonlocal experience_source
            if schema is ExperienceExtraction:
                experience_source = ExperienceSource(sources[0])
                return instruction + "\n" + format_resume_user_prompt(
                    experience_source.annotated_text
                )
            return instruction + "\n" + format_resume_user_prompt(sources[0])

        prompt = bind_screened_prompt(
            [resume_text],
            build_prompt,
        )
        group_name = _GROUP_NAMES[schema]
        with _group_tracer.start_as_current_span(
            f"resume_parse.group.{group_name}",
            record_exception=False,
            set_status_on_exception=False,
        ) as span:
            span.set_attribute("resume_parse.group", group_name)
            result = await resume_parsing_agent.run(
                prompt,
                output_type=(
                    experience_source.output_type
                    if experience_source is not None
                    else schema
                ),
                model=generative_model(model, fallback_model),
                model_settings=ModelSettings(thinking=thinking),
                capabilities=[budget],
                usage_limits=agent_usage_limits(load_settings()),
            )
            span.set_attribute("resume_parse.requests", result.usage.requests)
            span.set_attribute("resume_parse.input_tokens", result.usage.input_tokens)
            span.set_attribute("resume_parse.cached_input_tokens", result.usage.cache_read_tokens)
            span.set_attribute("resume_parse.output_tokens", result.usage.output_tokens)
            return result, experience_source

    async with asyncio.timeout(remaining_timeout(timeout_seconds)):
        settings = load_settings()
        screening = await screen_user_text_async(
            resume_text,
            settings.user_text_screen_model,
            remaining_timeout(timeout_seconds),
            max_characters=len(resume_text),
            classify=prompt_guardrail._screen_prompt_text,
        )
        if not screening.allowed:
            raise InputBlocked(UNCHECKED_MESSAGE if screening.unchecked else BLOCKED_MESSAGE)
        with record_prompt_version(RESUME_PARSING_PROMPT_VERSION):
            tasks = [asyncio.create_task(extract(schema)) for schema in _GROUPS]
            try:
                results = await asyncio.gather(*tasks)
            finally:
                for task in tasks:
                    if not task.done():
                        task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    fields = {}
    suggestions = []
    warnings = []
    usage = RunUsage()
    charges = []
    for result, experience_source in results:
        values = (
            experience_source.reconstruct(result.output)
            if experience_source is not None
            else result.output.model_dump()
        )
        suggestions.extend(values.pop("job_title_suggestions", []))
        warnings.extend(values.pop("parsing_warnings"))
        fields.update(values)
        usage.incr(result.usage)
        answering_model = reported_model_name(result.response.model_name or model, model)
        charges.append(build_model_usage(answering_model, result.usage))
    return ResumeParsingRun(
        ParsedResume(**fields, parsing_warnings=list(dict.fromkeys(warnings))),
        usage,
        (charges[0].model if len({charge.model for charge in charges}) == 1 else model),
        charges,
        suggestions,
    )
