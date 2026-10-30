"""Classify listing preferences with JEV and copy evidence only from fixed source IDs.

One run asks both sides of every criterion in one request, never generates evidence prose.
Inputs are bounded and labeled as data; this workflow does not classify prompt injection.
"""
import asyncio
from enum import Enum

from pydantic import Field, create_model
from pydantic_ai import Agent
from pydantic_ai.usage import UsageLimits
from pydantic_ai_harness import InputGuardrail

from conversation_logging import ConversationLogging
from llm.usage import accounted_model
from model_inputs.blocks import source_block
from privacy.contact_mask import mask_outbound
from prompts.job_preference_instructions import (
    JOB_PREFERENCE_INSTRUCTIONS,
    JOB_PREFERENCE_PROMPT_VERSION,
)
from screening.session import remaining_timeout
from settings import JEV_SCREEN_MODEL
from telemetry.tracing import record_prompt_version
from text_limits import MAX_PROMPT_TEXT

JEV_PREFERENCE_MODEL = JEV_SCREEN_MODEL


async def check_preference_input(ctx, prompt):
    """Reject empty or oversized prompts without classifying their contents."""
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > MAX_PROMPT_TEXT:
        raise ValueError("Preference input must be bounded nonblank text")
    return True


job_preference_agent = Agent(name="job_preference_agent", output_type=bool,
    instructions=JOB_PREFERENCE_INSTRUCTIONS, retries=0, defer_model_check=True,
    capabilities=[ConversationLogging(), InputGuardrail(guard=check_preference_input)])


def listing_decision_schema(criteria, listing):
    """Offer only immutable passage IDs and a missing-evidence option to the model."""
    options = Enum("PreferencePassageChoice", {"none": "none", **{p.id: p.id for p in listing.passages}})
    fields = {}
    for index, _criterion in enumerate(criteria):
        for side, meaning in (("support", "explicitly supports the complete condition"),
                              ("contradiction", "explicitly contradicts the condition")):
            fields[f"c{index}_{side}"] = (options, Field(description=(
                f"Which source passage {meaning} for criterion C{index + 1}? "
                "Choose none when that evidence is missing or ambiguous.")))
    return create_model("JobPreferenceEvidence", **fields)


def render_preference_prompt(criteria, listing):
    """Render labeled criteria and source passages without serialized object dumps."""
    sources = [c.text for c in criteria] + [p.text for p in listing.passages]
    count = len(criteria)
    def render(values):
        preferences = "\n".join(f"C{i + 1}: {source_block('preference', value)}" for i, value in enumerate(values[:count]))
        passages = "\n".join(f"{p.id}: {source_block('posting_passage', text)}" for p, text in zip(listing.passages, values[count:], strict=True))
        return f"Confirmed job preferences:\n{preferences}\n\nListing source passages:\n{passages}"
    return render(sources)


async def assess_preference_listing(criteria, listing, *, usage=None):
    """Return grounded decisions and request usage; no fallback writes matching prose."""
    schema = listing_decision_schema(criteria, listing)
    prompt = mask_outbound(render_preference_prompt(criteria, listing))
    async with asyncio.timeout(remaining_timeout(30)):
        with record_prompt_version(JOB_PREFERENCE_PROMPT_VERSION):
            result = await job_preference_agent.run(prompt, output_type=schema,
                model=accounted_model(JEV_PREFERENCE_MODEL), usage=usage,
                usage_limits=UsageLimits(request_limit=1, total_tokens_limit=24_000, output_tokens_limit=2_000))
    by_id = {p.id: p.text for p in listing.passages}
    decisions = []
    for index, criterion in enumerate(criteria):
        def evidence(side, index=index):
            value = getattr(result.output, f"c{index}_{side}").value
            return None if value == "none" else {"passage_id": value, "text": by_id[value]}
        support, contradiction = evidence("support"), evidence("contradiction")
        if support and contradiction:
            status, reason = "unknown", "contradictory_evidence"
        elif support:
            status, reason = "matching", "supported"
        elif contradiction:
            status, reason = "conflicting", "contradicted"
        else:
            status, reason = "unknown", "incomplete_source" if listing.truncated else "not_stated"
        decisions.append({"id": str(criterion.id), "status": status, "reason": reason,
            "support": support, "contradiction": contradiction})
    return {"id": str(listing.id), "source_digest": listing.source_digest, "truncated": listing.truncated, "criteria": decisions}, result
