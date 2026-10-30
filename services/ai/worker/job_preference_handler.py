"""Assess a bounded frozen search batch against its owner's confirmed preferences.

Rails owns identity, provenance and persistence. The worker screens only unknown sources,
returns extractive evidence, and bounds all screening and decision calls for this task.
"""
import asyncio
import json

from pydantic import ValidationError
from pydantic_ai.exceptions import UsageLimitExceeded

from agents.job_preference_agent import JEV_PREFERENCE_MODEL, assess_preference_listing
from llm.model_prices import build_model_usage
from llm.usage import current_task_usage, model_request_budget
from schemas.job_preferences import PreferenceCheckInput
from screening.record_adapters import job_preference_records
from screening.records import record_failure_message, screen_records_sync
from screening.screen_user_text import observe_screen_chunks
from screening.session import (
    trust_generated_source,
    within_screening_session,
)
from worker.queue_messages import AiResultMessage

MAX_SCREEN_CHUNKS = 128
MAX_MODEL_REQUESTS = 240  # Includes actual screening, fallback, decision and validation requests.
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
    """Return a complete evidence check or an explicit failure, never partial fake unknowns."""
    try:
        snapshot = PreferenceCheckInput.model_validate(task.input)
    except ValidationError:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="Checking preferences needs 1–100 current listings and up to ten confirmed criteria.")
    requests = 0
    usage = []
    failure_code = "input_rejected"
    def budget():
        nonlocal requests
        requests += 1
        if requests > MAX_SCREEN_CHUNKS:
            raise UsageLimitExceeded("This preference check exceeded its screening request budget.")
        observed = current_task_usage()
        if observed and sum(e.input_tokens + e.output_tokens for e in observed.entries) >= MAX_TASK_TOKENS:
            raise UsageLimitExceeded("This preference check exceeded its token budget.")

    with model_request_budget(request_limit=MAX_MODEL_REQUESTS, token_limit=MAX_TASK_TOKENS), observe_screen_chunks(budget):
        for criterion in snapshot.criteria:
            if criterion.trusted_generated:
                trust_generated_source(criterion.text)
        sources = [criterion.text for criterion in snapshot.criteria]
        sources.extend(passage.text for listing in snapshot.listings for passage in listing.passages)
        outcome = screen_records_sync(job_preference_records(snapshot.criteria, snapshot.listings),
                                      approved_sources=sources)
        usage.extend(outcome.decision.model_usages)
        if not outcome.allowed:
            failure_code = "screening_unavailable" if outcome.decision.unchecked or outcome.decision.too_long else "input_rejected"
            return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
                result={"failure_code": failure_code}, error_message=record_failure_message(outcome))
        assessed = asyncio.run(assess_listings(snapshot.criteria, snapshot.listings))
    usage.extend(build_model_usage(JEV_PREFERENCE_MODEL, run.usage) for _, run in assessed)
    if sum(item.input_tokens + item.output_tokens for item in usage) > MAX_TASK_TOKENS:
        raise UsageLimitExceeded("This preference check exceeded its token budget.")
    listings = [value for value, _ in assessed]
    for listing in listings:
        passages = {}
        for decision in listing["criteria"]:
            for side in ("support", "contradiction"):
                evidence = decision[side]
                if evidence:
                    passages[evidence["passage_id"]] = evidence
                    decision[side] = {"passage_id": evidence["passage_id"]}
        listing["evidence_passages"] = list(passages.values())
    result = {"confirmed_revision": snapshot.confirmed_revision, "listings": listings}
    completed = AiResultMessage(ai_task_id=task.ai_task_id, status="completed", usage=usage, result=result)
    if len(json.dumps(result, ensure_ascii=False).encode("utf-8")) > MAX_RESULT_BYTES or len(completed.model_dump_json().encode("utf-8")) > MAX_ENVELOPE_BYTES:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage,
            error_message="This check has too much listing evidence. Narrow your search or check fewer results.")
    return completed
