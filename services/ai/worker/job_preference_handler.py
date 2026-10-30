"""Assess a bounded frozen search batch against its owner's confirmed preferences.

Rails owns identity and persistence. The worker returns independent probabilities and bounds
all decision calls; preference checks do not classify inputs for prompt injection.
"""
import asyncio
import json

from pydantic import ValidationError
from pydantic_ai.exceptions import UsageLimitExceeded

from agents.job_preference_agent import JEV_PREFERENCE_MODEL, assess_preference_listing
from llm.model_prices import build_model_usage
from llm.usage import model_request_budget
from schemas.job_preferences import PreferenceCheckInput
from screening.session import within_screening_session
from worker.queue_messages import AiResultMessage

MAX_MODEL_REQUESTS = 240  # Includes decision and validation requests.
MAX_TASK_TOKENS = 600_000
MAX_CONCURRENT_DECISIONS = 4
MAX_RESULT_BYTES = 160_000  # Leave queue space for concrete model usage and execution metadata.
MAX_ENVELOPE_BYTES = 240_000


async def assess_listings(criteria, listings):
    """Keep source order, bound concurrency, and finish cancellation before returning a failure."""
    semaphore = asyncio.Semaphore(MAX_CONCURRENT_DECISIONS)
    async def assess(listing):
        async with semaphore:
            return await assess_preference_listing(criteria, listing)
    tasks = [asyncio.create_task(assess(listing)) for listing in listings]
    try:
        return await asyncio.gather(*tasks)
    except BaseException:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        raise


@within_screening_session
def handle_job_preference_check_task(task, dependencies):
    """Return complete preference probabilities or an explicit failure."""
    try:
        snapshot = PreferenceCheckInput.model_validate(task.input)
    except ValidationError:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="Checking preferences needs 1–100 current listings and up to ten confirmed criteria.")
    usage = []
    with model_request_budget(request_limit=MAX_MODEL_REQUESTS, token_limit=MAX_TASK_TOKENS):
        assessed = asyncio.run(assess_listings(snapshot.criteria, snapshot.listings))
    usage.extend(build_model_usage(JEV_PREFERENCE_MODEL, run.usage) for _, run in assessed)
    if sum(item.input_tokens + item.output_tokens for item in usage) > MAX_TASK_TOKENS:
        raise UsageLimitExceeded("This preference check exceeded its token budget.")
    listings = [value for value, _ in assessed]
    result = {"confirmed_revision": snapshot.confirmed_revision, "listings": listings}
    completed = AiResultMessage(ai_task_id=task.ai_task_id, status="completed", usage=usage, result=result)
    if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > MAX_RESULT_BYTES or len(completed.model_dump_json().encode("utf-8")) > MAX_ENVELOPE_BYTES:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="This check has too many preference probabilities. Narrow your search or check fewer results.")
    return completed
