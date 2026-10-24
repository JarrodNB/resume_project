"""Place clear source bullets and leave genuinely uncertain ownership for review.

The optional model pass can only select an existing role using another bullet already
assigned to it as evidence. Local checks reject unsupported or competing suggestions.
"""

import re

from pydantic_ai.settings import ModelSettings
from pydantic_ai.usage import RunUsage

from agents.resume_placement_agent import resume_placement_agent
from prompts.resume_placement_instructions import RESUME_PLACEMENT_PROMPT_VERSION
from resume_import.source import _DATE, ResumeSource
from schemas.resume_import import ResumeImportExtraction
from screening.session import bind_screened_prompt
from worker.model_prices import build_model_usage, reported_model_name
from worker.run_limits import agent_usage_limits
from worker.task_usage import current_task_usage
from worker.tracing import record_prompt_version

_WORD = re.compile(r"[a-z0-9]{5,}", re.IGNORECASE)
_FENCE = re.compile(r"<\s*/?\s*resume\s*>", re.IGNORECASE)
_COMMON = {"about", "across", "after", "before", "built", "created", "delivered", "developed", "during", "helped", "improved", "leading", "managed", "project", "projects", "system", "systems", "their", "using", "which", "while", "worked"}


def _terms(text):
    return set(_WORD.findall(text.casefold())) - _COMMON


def _roles(output):
    return {record.source_id: record for record in output.records if record.type == "experience"}


def _move(output, bullet_id, role_id):
    role = _roles(output)[role_id]
    role.fields.highlight_ids.append(bullet_id)
    output.unassigned_highlights = [
        item for item in output.unassigned_highlights if item.source_id != bullet_id
    ]


def place_single_role_bullets(source: ResumeSource, output: ResumeImportExtraction):
    """Use one nearby role only when no other heading intervenes."""
    roles = _roles(output)
    if len(roles) != 1:
        return
    role_id = next(iter(roles))
    role_line = source.passages[role_id].start_line
    for item in list(output.unassigned_highlights):
        bullet_line = source.passages[item.source_id].start_line
        between = [
            passage for passage in source.passages.values()
            if not passage.bullet and role_line < passage.start_line < bullet_line
        ]
        if (
            item.reason == "ambiguous_role"
            and bullet_line > role_line
            and all(_DATE.search(passage.text) for passage in between)
        ):
            _move(output, item.source_id, role_id)


def _evidence(source, output):
    evidence = {}
    for role_id, role in _roles(output).items():
        for bullet_id in role.fields.highlight_ids:
            evidence[bullet_id] = (role_id, source.passages[bullet_id].text)
    return evidence


async def place_with_model(source, output, screened_chunks, budget, model, thinking, settings):
    """Return optional usage after one batched, source-backed placement request."""
    pending = [item for item in output.unassigned_highlights if item.reason == "ambiguous_role"]
    roles = _roles(output)
    evidence = _evidence(source, output)
    if not pending or len(roles) < 2 or not evidence:
        return None

    def render(approved_chunks):
        # Build every quoted passage from the approved input, not from model prose.
        approved = ResumeSource("\n".join(approved_chunks))
        lines = ["Ambiguous bullets:"]
        for item in pending:
            lines.append(f"[{item.source_id}] {approved.passages[item.source_id].text}")
        lines.append("Candidate roles and their already assigned evidence:")
        for role_id, role in roles.items():
            lines.append(f"[{role_id}] {approved.passages[role_id].text}")
            for bullet_id in role.fields.highlight_ids:
                lines.append(f"  [{bullet_id}] {approved.passages[bullet_id].text}")
        body = _FENCE.sub(lambda match: match.group().replace("<", "&lt;"), "\n".join(lines))
        return "<resume>\n" + body + "\n</resume>"

    prompt = bind_screened_prompt(screened_chunks, render)
    if budget.usage.requests >= settings.llm_request_limit:
        return None
    observed = current_task_usage()
    previous_entries = len(observed.entries) if observed else 0
    try:
        with record_prompt_version(RESUME_PLACEMENT_PROMPT_VERSION):
            result = await resume_placement_agent.run(
                prompt,
                model=budget,
                model_settings=ModelSettings(thinking=thinking),
                usage_limits=agent_usage_limits(settings),
            )
    except Exception:  # noqa: BLE001 - optional placement must not lose the extracted resume
        # This pass is optional. Keep the original bullets for human review.
        return RunUsage(), observed.entries[previous_entries:] if observed else []
    pending_ids = {item.source_id for item in pending}
    used = set()
    for suggestion in result.output.suggestions:
        bullet_id, role_id, evidence_id = (
            suggestion.bullet_id, suggestion.role_id, suggestion.evidence_id
        )
        if bullet_id not in pending_ids or bullet_id in used or role_id not in roles:
            continue
        if evidence_id not in evidence or evidence[evidence_id][0] != role_id:
            continue
        shared = _terms(source.passages[bullet_id].text) & _terms(evidence[evidence_id][1])
        if not shared:
            continue
        if any(
            shared & _terms(text)
            for other_id, text in evidence.values()
            if other_id != role_id
        ):
            continue
        _move(output, bullet_id, role_id)
        used.add(bullet_id)
    answering_model = reported_model_name(result.response.model_name or model, model)
    return result.usage, [build_model_usage(answering_model, result.usage)]
