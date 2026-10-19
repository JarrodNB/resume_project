"""Extract three complete resume sections concurrently from one screened source.

The public interface returns one ParsedResume only after all groups succeed. The parser
owns group assembly, one deadline and combined budgets, and awaits cancelled siblings.
"""

import asyncio
import re
from typing import NamedTuple

from opentelemetry import trace
from pydantic_ai import Agent
from pydantic_ai.capabilities import AbstractCapability
from pydantic_ai.settings import ModelSettings, ThinkingEffort
from pydantic_ai.usage import RunUsage
from pydantic_ai_harness import InputBlocked, InputGuardrail

from prompts.resume_parsing_instructions import (
    RESUME_PARSING_INSTRUCTIONS,
    RESUME_PARSING_PROMPT_VERSION,
    format_resume_group_instruction,
)
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
from worker.generative_model import generative_model
from worker.model_prices import build_model_usage, reported_model_name
from worker.queue_messages import ModelUsage
from worker.run_limits import agent_usage_limits
from worker.settings import load_settings
from worker.tracing import record_prompt_version

# A resume can contain the fence tags, including a space or newline inside the tag.
# Replacing "<" keeps the words and stops the tag closing.
_RESUME_TAG = re.compile(r"<\s*/?\s*resume\s*>", re.IGNORECASE)
_BULLET_LINE = re.compile(r"^\s*(?:[•●▪◦‣⁃✓*+\-–—]|\d+[.)])\s+(.*)$")
_DATE_LINE = re.compile(
    r"^(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?"
    r"(?:\d{1,2}/)?(?:19|20)\d{2}(?:[-/]\d{1,2})?\s*[-–—]\s*"
    r"(?:(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?"
    r"(?:\d{1,2}/)?(?:19|20)\d{2}(?:[-/]\d{1,2})?|present|current)\.?$",
    re.IGNORECASE,
)
_DATE_PART = (
    r"(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+)?"
    r"(?:\d{1,2}/)?(?:19|20)\d{2}(?:[-/]\d{1,2})?"
)
_DATE_RANGE_SUFFIX = re.compile(
    rf"{_DATE_PART}\s*[-–—]\s*(?:{_DATE_PART}|present|current)\.?$",
    re.IGNORECASE,
)
_ROLE_HEADER_SEPARATOR = re.compile(r",\s+|\s+[|–—-]\s+|\s+at\s+", re.IGNORECASE)
_SECTION_HEADINGS = {
    "summary", "professional summary", "career summary", "objective", "career objective",
    "profile", "experience", "work experience", "work history",
    "professional experience", "professional history", "career experience", "career history",
    "employment", "employment history", "education", "skills", "technical skills",
    "core competencies", "competencies", "projects", "personal projects",
    "side projects", "selected projects", "academic projects", "open source projects",
    "open-source projects", "project experience", "selected builds",
    "certifications", "credentials", "training", "toolbox", "awards", "honors",
    "publications", "languages", "interests", "volunteer experience",
}
_EXPERIENCE_HEADINGS = {
    "experience", "work experience", "work history", "professional experience",
    "professional history", "career experience", "career history", "employment", "employment history",
    "volunteer experience",
}
_DATE_EXCLUDED_SECTION_HEADINGS = {
    "education", "skills", "technical skills", "core competencies", "competencies",
    "projects", "personal projects", "side projects", "selected projects", "academic projects",
    "open source projects", "open-source projects", "project experience", "selected builds",
    "certifications", "credentials",
    "training", "toolbox", "awards", "honors", "publications", "languages", "interests",
}


def _section_kind(line: str) -> str | None:
    """Tell work history headings from sections whose bullets are not job highlights."""
    heading = line.strip().rstrip(": ").casefold()
    if heading in _EXPERIENCE_HEADINGS:
        return "experience"
    if heading in _SECTION_HEADINGS:
        return "other"
    return None


def _looks_like_title_case_label(text: str, *, minimum_words: int = 1) -> bool:
    """Recognize compact title/company lines without treating sentence fragments as headers."""
    words = re.findall(r"[A-Za-z][A-Za-z&.'’/-]*", text)
    connector_words = {"and", "at", "for", "of", "the", "to"}
    return (
        minimum_words <= len(words) <= 8
        and all(word[0].isupper() or word.casefold() in connector_words for word in words)
    )


def _is_resume_boundary(line: str, next_line: str, after_next_line: str = "") -> bool:
    """Recognize section headings and role/date headers between source bullets."""
    text = line.strip()
    if not text:
        return True
    letters = [char for char in text if char.isalpha()]
    if _section_kind(text) or (
        len(text) <= 60 and len(letters) >= 3 and all(char.isupper() for char in letters)
    ):
        return True
    if _DATE_LINE.fullmatch(text):
        return True
    if len(text) <= 120 and _DATE_RANGE_SUFFIX.search(text):
        return True
    if len(text) <= 120 and not text.endswith((".", "!", "?")):
        role_parts = _ROLE_HEADER_SEPARATOR.split(text)
        if len(role_parts) > 1 and all(
            part.strip() and part.strip()[0].isupper() for part in role_parts
        ):
            return True
        if (
            _looks_like_title_case_label(text, minimum_words=2)
            and _looks_like_title_case_label(next_line)
            and (
                _DATE_LINE.fullmatch(after_next_line.strip())
                or _BULLET_LINE.match(after_next_line)
            )
        ):
            return True
    return bool(len(text) <= 120 and _DATE_LINE.fullmatch(next_line.strip()))


def _source_bullet_map(resume_text: str) -> tuple[dict[str, str], dict[int, str]]:
    """Split visible bullets, retaining wrapped continuation lines verbatim."""
    bullets: dict[str, str] = {}
    bullet_lines: dict[int, str] = {}
    current_id = None
    current_lines: list[str] = []
    lines = resume_text.splitlines()
    has_experience_heading = any(_section_kind(line) == "experience" for line in lines)
    has_date_header = any(
        _DATE_LINE.fullmatch(line.strip()) or _DATE_RANGE_SUFFIX.search(line.strip())
        for line in lines
    )
    in_experience_section = not has_experience_heading and not has_date_header
    in_date_excluded_section = False

    def save():
        if current_id is not None:
            bullets[current_id] = "\n".join(current_lines)

    for index, line in enumerate(lines):
        section = _section_kind(line)
        if section:
            save()
            current_id, current_lines = None, []
            in_experience_section = section == "experience"
            heading = line.strip().rstrip(": ").casefold()
            in_date_excluded_section = heading in _DATE_EXCLUDED_SECTION_HEADINGS
            continue
        if not has_experience_heading and not in_date_excluded_section and (
            _DATE_LINE.fullmatch(line.strip()) or _DATE_RANGE_SUFFIX.search(line.strip())
        ):
            save()
            current_id, current_lines = None, []
            in_experience_section = True
            continue
        match = _BULLET_LINE.match(line)
        if match:
            save()
            if in_experience_section:
                current_id = f"B{len(bullets) + 1}"
                current_lines = [match.group(1)]
                bullet_lines[index] = current_id
            else:
                current_id, current_lines = None, []
        elif current_id is not None and line.strip() and not _is_resume_boundary(
            line,
            lines[index + 1] if index + 1 < len(lines) else "",
            lines[index + 2] if index + 2 < len(lines) else "",
        ) and (
            line[: len(line) - len(line.lstrip())]
            or line.lstrip()[:1].islower()
            or len(current_lines[-1]) >= 30
            or not current_lines[-1].rstrip().endswith((".", "!", "?"))
        ):
            current_lines.append(line.strip())
        elif current_id is not None:
            save()
            current_id, current_lines = None, []
    save()
    return bullets, bullet_lines


def _source_bullets(resume_text: str) -> dict[str, str]:
    """Return exact, request-local passages for eligible work-experience bullets."""
    return _source_bullet_map(resume_text)[0]


def _experience_prompt(resume_text: str) -> tuple[str, dict[str, str]]:
    """Add local IDs beside eligible source bullets while preserving their role context."""
    bullets, bullet_lines = _source_bullet_map(resume_text)
    lines = resume_text.splitlines()
    for line_index, bullet_id in bullet_lines.items():
        line = lines[line_index]
        match = _BULLET_LINE.match(line)
        lines[line_index] = f"{line[:match.start()]}[{bullet_id}] {line[match.start():]}"
    return format_resume_user_prompt("\n".join(lines)), bullets


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
    defer_model_check=True,
    capabilities=[InputGuardrail(guard=screen_prompt)],
)


class ResumeParsingRun(NamedTuple):
    """The agent's output, the tokens it used, and the model name to bill."""

    parsed_resume: ParsedResume
    usage: RunUsage
    model: str = ""
    model_usages: list[ModelUsage] | None = None


@within_screening_session
def parse_resume_text(
    resume_text: str,
    model: str,
    thinking: ThinkingEffort,
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
    thinking: ThinkingEffort,
    timeout_seconds: float,
    fallback_model: str,
) -> ResumeParsingRun:
    """Return all three groups in source order, cancelling and awaiting siblings on failure."""
    budget = ParsingBudget(agent_usage_limits(load_settings()))

    async def extract(schema):
        instruction = format_resume_group_instruction(schema.__name__)
        bullet_map = {}
        def build_prompt(sources):
            if schema is ExperienceExtraction:
                prompt, bullets = _experience_prompt(sources[0])
                bullet_map.update(bullets)
                return instruction + "\n" + prompt
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
                output_type=schema,
                model=generative_model(model, fallback_model),
                model_settings=ModelSettings(thinking=thinking),
                capabilities=[budget],
                usage_limits=agent_usage_limits(load_settings()),
            )
            span.set_attribute("resume_parse.requests", result.usage.requests)
            span.set_attribute("resume_parse.input_tokens", result.usage.input_tokens)
            span.set_attribute("resume_parse.cached_input_tokens", result.usage.cache_read_tokens)
            span.set_attribute("resume_parse.output_tokens", result.usage.output_tokens)
            return result, bullet_map

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
    warnings = []
    usage = RunUsage()
    charges = []
    for result, bullet_map in results:
        values = result.output.model_dump()
        if isinstance(result.output, ExperienceExtraction):
            seen = set()
            rebuilt = []
            bullet_order = {bullet_id: index for index, bullet_id in enumerate(bullet_map)}
            for role in values["experiences"]:
                bullet_ids = role.pop("highlight_ids")
                if (
                    len(bullet_ids) != len(set(bullet_ids))
                    or any(bullet_id not in bullet_map or bullet_id in seen for bullet_id in bullet_ids)
                ):
                    raise ValueError("Experience extraction returned an invalid source bullet ID")
                seen.update(bullet_ids)
                highlights = [
                    bullet_map[bullet_id]
                    for bullet_id in sorted(bullet_ids, key=bullet_order.__getitem__)
                ]
                role["highlights"] = highlights
                rebuilt.append(role)
            values["experiences"] = rebuilt
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
    )
