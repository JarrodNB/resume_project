"""Assess a frozen searched listing against its owner's confirmed preferences.

Rails owns identity, provenance and persistence. The worker screens only unknown sources,
returns extractive evidence, and bounds all screening and decision calls for this task.
"""
import asyncio

from pydantic import ValidationError
from pydantic_ai.exceptions import UsageLimitExceeded

from agents.job_preference_agent import JEV_PREFERENCE_MODEL, assess_preference_listing
from llm.model_prices import build_model_usage
from llm.usage import current_task_usage, model_request_budget
from schemas.job_preferences import PreferenceCheckInput
from screening.screen_user_text import ScreenOutcome, observe_screen_chunks, screen_user_text
from screening.session import (
    approve_projected_source,
    trust_generated_source,
    within_screening_session,
)
from worker.queue_messages import AiResultMessage

MAX_SCREEN_CHUNKS = 16  # Each allows primary plus one fallback: at most 32 calls, then one decision.
MAX_TASK_TOKENS = 64_000


@within_screening_session
def handle_job_preference_check_task(task, dependencies):
    """Return a complete evidence check or an explicit failure, never partial fake unknowns."""
    try:
        snapshot = PreferenceCheckInput.model_validate(task.input)
    except ValidationError:
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed",
            error_message="Checking preferences needs one current listing and up to ten confirmed criteria.")
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

    def approve(text, *, generated=False, checked=False):
        nonlocal failure_code
        if generated:
            trust_generated_source(text)
            return True
        if checked:
            approve_projected_source(text, text, lambda value: value, ScreenOutcome(allowed=True))
            return True
        screen = screen_user_text(text, model=dependencies.settings.user_text_screen_model,
            timeout_seconds=dependencies.settings.llm_run_timeout_seconds)
        usage.extend(screen.model_usages)
        failure_code = "screening_unavailable" if screen.unchecked or screen.too_long else "input_rejected"
        return screen.allowed

    with model_request_budget(request_limit=33, token_limit=MAX_TASK_TOKENS), observe_screen_chunks(budget):
        for criterion in snapshot.criteria:
            if not approve(criterion.text, generated=criterion.trusted_generated, checked=criterion.screened):
                return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage, result={"failure_code": failure_code},
                    error_message="A preference could not be screened. Edit it or try checking again later.")
        listing = snapshot.listings[0]
        source = "\n".join(p.text for p in listing.passages)
        if not approve(source, checked=listing.screened):
            return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", usage=usage, result={"failure_code": failure_code},
                error_message="This listing could not be screened. Try checking again later.")
        # The single cohesive listing was screened once; bind its exact selected passages.
        for passage in listing.passages:
            approve_projected_source(passage.text, source,
                lambda _value, exact=source: exact, ScreenOutcome(allowed=True))
        result, run = asyncio.run(assess_preference_listing(snapshot.criteria, listing))
    usage.append(build_model_usage(JEV_PREFERENCE_MODEL, run.usage))
    if sum(item.input_tokens + item.output_tokens for item in usage) > MAX_TASK_TOKENS:
        raise UsageLimitExceeded("This preference check exceeded its token budget.")
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", usage=usage,
        result={"confirmed_revision": snapshot.confirmed_revision, "listings": [result]})
