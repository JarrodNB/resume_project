"""Estimate one independent probability for each confirmed job preference.

A dynamic schema contains at most ten bounded probability fields, never passage choices.
Inputs are bounded and labeled as data; this workflow does not classify prompt injection.
"""
import asyncio

from pydantic import ConfigDict, Field, create_model
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


def listing_decision_schema(criteria):
    """Use Jev's native probability primitive once for each of 1–10 preferences."""
    if not 1 <= len(criteria) <= 10:
        raise ValueError("Preference probabilities require 1–10 confirmed preferences")
    fields = {}
    for index, criterion in enumerate(criteria, 1):
        condition = source_block("preference", mask_outbound(criterion.text))
        fields[f"p{index}"] = (float, Field(ge=0, le=1, strict=True, allow_inf_nan=False,
            description=f"Probability this posting satisfies the complete desired condition: {condition}"))
    return create_model("JobPreferenceProbabilities", __config__=ConfigDict(extra="forbid"), **fields)


def render_preference_prompt(criteria, listing):
    """Render preferences and posting text as bounded data, with no passage-ID choices."""
    sources = [c.text for c in criteria] + [p.text for p in listing.passages]
    count = len(criteria)
    def render(values):
        preferences = "\n".join(f"Preference {i + 1}: {source_block('preference', value)}" for i, value in enumerate(values[:count]))
        passages = "\n".join(source_block("posting_text", text) for text in values[count:])
        return f"Confirmed job preferences:\n{preferences}\n\nPosting text:\n{passages}"
    return render(sources)


async def assess_preference_listing(criteria, listing, *, usage=None):
    """Return native independent probabilities and usage, with no confidence conversion."""
    schema = listing_decision_schema(criteria)
    prompt = mask_outbound(render_preference_prompt(criteria, listing))
    async with asyncio.timeout(remaining_timeout(30)):
        with record_prompt_version(JOB_PREFERENCE_PROMPT_VERSION):
            result = await job_preference_agent.run(prompt, output_type=schema,
                model=accounted_model(JEV_PREFERENCE_MODEL), usage=usage,
                usage_limits=UsageLimits(request_limit=1, total_tokens_limit=24_000, output_tokens_limit=2_000))
    probabilities = [{"id": str(criterion.id), "probability": getattr(result.output, f"p{index}")}
        for index, criterion in enumerate(criteria, 1)]
    return {"id": str(listing.id), "source_digest": listing.source_digest,
        "truncated": listing.truncated, "criteria": probabilities}, result
