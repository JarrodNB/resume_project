"""Screen a frozen owned snapshot and return a proposal; Rails accepts it separately.

Saved exact screening approvals stay execution-local. Rejected facts fail closed rather
than allowing uncited material or stale screening receipts into later live career data.
"""
import json

from pydantic import ValidationError
from pydantic_ai import capture_run_messages
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import ModelResponse
from pydantic_ai.usage import RunUsage

from agents.summary_generation_agent import generate_summary
from llm.model_prices import build_model_usage, reported_model_name
from model_inputs.summary_generation import render_summary_sources
from privacy.contact_mask import mask_outbound
from schemas.summary_generation import SummaryGenerationInput
from screening.screen_user_text import screen_user_text
from screening.session import bind_screened_prompt, current_session, within_screening_session
from worker.queue_messages import AiResultMessage


@within_screening_session
def handle_summary_generation_task(task, dependencies):
    usage = []
    def failed(message):
        return AiResultMessage(ai_task_id=task.ai_task_id, status="failed", error_message=message, usage=usage)
    try:
        if len(json.dumps(task.input, ensure_ascii=False).encode()) > 180_000:
            return failed("This career evidence is too large to summarize. Reduce its text and try again.")
        snapshot = SummaryGenerationInput.model_validate(task.input)
    except ValidationError:
        return failed("This summary request is invalid. Start a new request.")
    sources = [source for source in snapshot.sources if source.text.strip()]
    if not sources:
        return failed("Add career information before generating a summary.")
    settings = dependencies.settings
    unchecked = [source for source in sources if not source.screened]
    if unchecked:
        # Check only unknown fields, together in readable form. Known exact approvals
        # are not rescreened, and batching avoids one provider request per small field.
        checked_text = render_summary_sources([source.label for source in unchecked],
            [mask_outbound(source.text) for source in unchecked])
        outcome = screen_user_text(checked_text, model=settings.user_text_screen_model,
            timeout_seconds=settings.llm_run_timeout_seconds, check_phrases=False)
        usage.extend(outcome.model_usages)
        if not outcome.allowed:
            return failed("Screening is unavailable. Try again later." if outcome.unchecked else
                "Some career information could not be used safely. Review it and try again.")
    current_session().allowed_sources.update(mask_outbound(source.text) for source in sources)
    labels = [source.label for source in sources]
    prompt = bind_screened_prompt([source.text for source in sources], lambda values: render_summary_sources(labels, values))
    try:
        with capture_run_messages() as messages:
            run = generate_summary(prompt, labels, settings)
    except UnexpectedModelBehavior:
        by_model = {}
        for message in messages:
            if isinstance(message, ModelResponse):
                model = reported_model_name(message.model_name or settings.library_edit_model, settings.library_edit_model)
                by_model.setdefault(model, RunUsage()).incr(message.usage)
        usage.extend(build_model_usage(model, tokens) for model, tokens in by_model.items())
        return failed("The AI could not produce a valid summary. Try again.")
    model = reported_model_name(run.response.model_name or settings.library_edit_model, settings.library_edit_model)
    return AiResultMessage(ai_task_id=task.ai_task_id, status="completed", result=run.output.model_dump(),
        usage=[*usage, build_model_usage(model, run.usage)])
